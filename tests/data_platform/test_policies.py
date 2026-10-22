from pathlib import Path
import tempfile
import unittest

from scripts.data_platform.pipeline import Store, collect, export_candidate
from scripts.data_platform.policies import public_policy, source_fingerprint
from test_pipeline import registry, NOW, response, xml


class PolicyTests(unittest.TestCase):
    def test_paid_unknown_or_wrong_dataset_permissions_never_publish(self):
        config = registry()
        source = config['sources'][0]
        source['publicDisplay'] = 'approved'
        self.assertEqual(public_policy(source, config, ['fx'])['citation'], 'ECB')
        for field, value in [('free', False), ('redistribution', False), ('status', 'unreviewed')]:
            old = config['policies']['test'][field]
            config['policies']['test'][field] = value
            with self.assertRaisesRegex(ValueError, 'not approved'):
                public_policy(source, config, ['fx'])
            config['policies']['test'][field] = old
        with self.assertRaises(ValueError):
            public_policy(source, config, ['financials'])

    def test_policy_change_invalidates_accepted_configuration_without_http(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            config['sources'][0]['publicDisplay'] = 'approved'
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            before = source_fingerprint(config['sources'][0], config)
            config['policies']['test']['version'] = '2'
            self.assertNotEqual(before, source_fingerprint(config['sources'][0], config))
            with self.assertRaisesRegex(ValueError, 'revalidated'):
                export_candidate(store, config, ['fx'], Path(directory) / 'stale', True, NOW)
            result = collect(store, config, transport=lambda *_: self.fail('Duplicate HTTP'), now=NOW)
            self.assertEqual(result['httpRequests'], 0)
            manifest = export_candidate(store, config, ['fx'], Path(directory) / 'approved', True, NOW)
            self.assertEqual(manifest['policies']['test']['version'], '2')

    def test_automation_permission_blocks_force_fetch_and_cached_reprocessing(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            self.addCleanup(store.close)
            config = registry()
            source = config['sources'][0]
            collect(store, config, transport=lambda *_: response(xml()), now=NOW)
            before = store.state(source['id'])
            config['policies']['test'].update(automatedCollection=False, reason='permission required')
            result = collect(store, config, transport=lambda *_: self.fail('Blocked HTTP'), now=NOW, force=True)
            self.assertEqual(result['httpRequests'], 0)
            self.assertEqual(result['blocked'], 1)
            self.assertEqual(result['sources'][0]['status'], 'blocked')
            self.assertEqual(store.state(source['id']), before)
            # The policy remains authoritative if a custom registry re-enables the source.
            self.assertTrue(source['enabled'])

    def test_restricted_issuer_sources_are_disabled_and_cannot_publish(self):
        from scripts.data_platform.pipeline import load_registry
        config = load_registry()
        sources = [s for s in config['sources'] if s.get('policyId') == 'issuer-review-required']
        self.assertEqual(len(sources), 10)
        policy = config['policies']['issuer-review-required']
        self.assertFalse(policy['automatedCollection'])
        self.assertEqual(policy['status'], 'blocked')
        for source in sources:
            self.assertFalse(source['enabled'])
            self.assertEqual(source['blockedReason'], 'issuer_permission_required')
            with self.assertRaises(ValueError):
                public_policy(source, config, source['datasets'])
