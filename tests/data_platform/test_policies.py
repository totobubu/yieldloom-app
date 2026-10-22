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
