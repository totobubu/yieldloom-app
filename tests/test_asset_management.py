"""Unified private asset scope, managed people and pre-registration inspection."""
import copy
import io
import json
import unittest
from unittest.mock import patch
import test_family_portfolio as fixture
from test_family_portfolio import api, pdf_parser


class AssetManagementTest(unittest.TestCase):
    setUp = fixture.FamilyApiTest.setUp
    post = fixture.FamilyApiTest.post
    get = fixture.FamilyApiTest.get
    new_account = fixture.FamilyApiTest.new_account

    def personal(self):
        return self.post('ensurePersonal', {'profileName': 'Alice'}).json['familyId']

    def managed(self, family, name='Partner', **extra):
        return self.post('addManagedProfile', {'familyId': family, 'name': name, **extra})

    def test_all_scope_preserves_originals_and_reads_each_document_once(self):
        target = self.personal()
        person = self.managed(target).json['profileId']
        created = self.post('createAccount', {'familyId': target, 'ownerId': person, 'institution': 'Broker', 'alias': 'Partner', 'type': 'general', 'last4': '4321'})
        self.assertEqual(created.status_code, 200, created.json)
        before = copy.deepcopy(self.db.data)
        result = self.get('familyId=__all__')
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(len(result.json['families']), 2)
        self.assertEqual({a['id'] for a in result.json['accounts']}, {self.account, created.json['accountId']})
        self.assertEqual(result.headers['X-Portfolio-Document-Reads'], '4')
        self.assertEqual(result.headers['X-Portfolio-Read-Operations'], '3')
        ledger = self.get('familyId=__all__&view=ledger')
        self.assertNotIn('families', ledger.json)
        self.assertTrue(all('snapshot' not in a for a in ledger.json['accounts']))
        self.assertEqual(self.db.data, before)
        empty = self.get('familyId=__all__', uid='nobody')
        self.assertEqual(empty.json['accounts'], [])
        self.assertEqual(self.db.data, before)

    def test_managed_people_are_private_and_legacy_origin_is_explicit(self):
        target = self.personal()
        self.assertEqual(self.managed(self.family).status_code, 403)
        profile = self.managed(target).json['profileId']
        self.assertEqual(self.db.data[f'familySpaces/{target}']['profiles'][profile]['managerUid'], 'alice')
        self.assertEqual(self.post('renameProfile', {'familyId': target, 'profileId': profile, 'name': 'Parent'}).status_code, 200)
        self.assertEqual(self.post('renameProfile', {'familyId': target, 'profileId': profile, 'name': 'Hijack'}, 'bob').status_code, 403)
        origin = dict(sourceFamilyId=self.family, sourceProfileId=self.owner)
        first = self.managed(target, **origin)
        second = self.managed(target, **origin)
        self.assertEqual(first.json['profileId'], second.json['profileId'])
        self.assertEqual(self.managed(target, sourceFamilyId=self.family, sourceProfileId='missing').status_code, 403)

    def test_inspection_returns_masked_identity_without_creating_documents(self):
        before = copy.deepcopy(self.db.data)
        def inspect(content=b'%PDF-fixture', **extra):
            return self.client.post('/api/family-portfolio?action=inspectAccountDocument', data={
                'file': (io.BytesIO(content), 'account.pdf'), 'password': 'fixture', **extra,
            }, headers={'Authorization': 'Bearer alice'})
        with patch.object(api, 'pdf_rows', side_effect=pdf_parser([])):
            result = inspect()
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json, {'customerName': 'PDF Test', 'maskedNumber': '****1234', 'institution': '토스증권'})
        self.assertEqual(result.headers['X-Portfolio-Document-Reads'], '0')
        self.assertEqual(inspect(b'invalid').status_code, 400)
        self.assertEqual(inspect(password='').status_code, 400)
        self.assertEqual(inspect(b'%PDF-' + b'a' * (2 * 1024 * 1024)).status_code, 413)
        self.assertEqual(self.db.data, before)

    def test_cross_space_reports_revalidate_membership_and_account_access(self):
        target = self.personal()
        person = self.managed(target).json['profileId']
        created = self.post('createAccount', {'familyId': target, 'ownerId': person, 'institution': 'Broker', 'alias': 'Partner', 'type': 'general'})
        ids = sorted([self.account, created.json['accountId']])
        statement = {'schemaVersion': 1, 'kind': 'yieldloom-monthly-dividends', 'month': '2026-09', 'asOf': '2026-10-18',
                     'currency': 'USD', 'scopeHash': api.digest(['alice', '__all__', ids]), 'accountCount': 2,
                     'recordCount': 0, 'unknownCount': 0, 'knownAmount': None, 'excludedDateCount': 0}
        body = {'familyId': '__all__', 'accountIds': ids, 'currency': 'USD', 'month': '2026-09', 'statement': statement,
                'expectedRevision': 0, 'accountRevisions': {key: 0 for key in ids}}
        saved = self.post('saveMonthlyStatement', body)
        self.assertEqual(saved.status_code, 200, saved.json)
        from urllib.parse import urlencode
        query = urlencode({'view': 'statements', 'familyId': '__all__', 'accountIds': json.dumps(ids), 'currency': 'USD'})
        self.assertEqual(len(self.get(query).json['reports']), 1)
        self.db.data[f'investmentAccounts/{created.json["accountId"]}']['permissions'] = {}
        self.assertEqual(self.get(query).status_code, 403)


if __name__ == '__main__':
    unittest.main()
