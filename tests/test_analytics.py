"""Aggregate-only writes, credential normalization and recoverable failures."""
import json
import os
import unittest
from unittest.mock import MagicMock, patch

from api import analytics


class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.client = analytics.app.test_client()

    def test_database_accepts_all_supported_credential_representations(self):
        fixture = {
            'type': 'service_account', 'project_id': 'fixture',
            'client_email': 'fixture@example.invalid', 'private_key': 'test-key-not-real',
        }
        raw = json.dumps(fixture)
        for value in [raw, json.dumps(raw), raw[1:-1]]:
            with self.subTest(format=value[:1]), \
                    patch.dict(os.environ, {'FIRESTORE_SA_KEY': value}), \
                    patch.object(analytics.firebase_admin, '_apps', {}), \
                    patch.object(analytics.credentials, 'Certificate') as certificate, \
                    patch.object(analytics.firebase_admin, 'initialize_app') as initialize, \
                    patch.object(analytics.firestore, 'client') as client:
                self.assertIs(analytics.database(), client.return_value)
                certificate.assert_called_once_with(fixture)
                initialize.assert_called_once_with(certificate.return_value)

    def test_success_only_persists_allowed_aggregate_fields(self):
        db = MagicMock()
        document = db.collection.return_value.document.return_value.collection.return_value.document.return_value
        with patch.object(analytics, 'database', return_value=db):
            response = self.client.post('/api/analytics', json={
                'event': 'search', 'cardKind': 'home', 'uid': 'not-to-be-stored',
                'query': 'private-input', 'account': 'not-to-be-stored',
            }, headers={'Origin': 'https://totobubu.github.io'})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://totobubu.github.io')
        stored = document.set.call_args.args[0]
        self.assertEqual(set(stored), {'event', 'cardKind', 'count', 'updatedAt'})
        self.assertEqual((stored['event'], stored['cardKind']), ('search', 'home'))
        self.assertEqual(document.set.call_args.kwargs, {'merge': True})

    def test_invalid_inputs_never_initialize_or_write_to_database(self):
        for payload in [None, ['search'], 42, {'event': []}, {'event': 'search', 'cardKind': {}},
                        {'event': 'unknown'}, {'event': 'search', 'cardKind': 'unknown'}]:
            with self.subTest(payload=payload), patch.object(analytics, 'database') as database:
                response = self.client.post('/api/analytics', data=json.dumps(payload), content_type='application/json')
                self.assertEqual(response.status_code, 400)
                database.assert_not_called()

    def test_unavailable_storage_is_reported_without_leaking_exception(self):
        for error in [RuntimeError('secret-config-value'), ValueError('secret-config-value')]:
            with self.subTest(error=type(error).__name__), \
                    patch.object(analytics, 'database', side_effect=error), \
                    self.assertLogs(analytics.app.logger, level='WARNING') as logs:
                response = self.client.post('/api/analytics', json={'event': 'card_open', 'cardKind': 'summary'})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.get_json(), {'error': 'aggregate service unavailable'})
            self.assertNotIn('secret-config-value', response.get_data(as_text=True))
            self.assertNotIn('secret-config-value', '\n'.join(logs.output))


if __name__ == '__main__':
    unittest.main()
