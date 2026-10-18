import copy
import io
import json
import unittest
import zipfile
from openpyxl import Workbook
import test_family_portfolio as family_test
from test_family_portfolio import api


def xlsx(rows):
    book = Workbook()
    for row in rows:
        book.active.append(row)
    stream = io.BytesIO()
    book.save(stream)
    book.close()
    return stream.getvalue()


class PortfolioExpansionTest(unittest.TestCase):
    setUp = family_test.FamilyApiTest.setUp
    post = family_test.FamilyApiTest.post
    get = family_test.FamilyApiTest.get
    new_account = family_test.FamilyApiTest.new_account
    join_bob = family_test.FamilyApiTest.join_bob
    commit = family_test.FamilyApiTest.commit

    def sheet(self, content, name='book.xlsx', action='preview', **extra):
        return self.client.post('/api/family-portfolio?action=' + action, data={
            'accountId': self.account, 'ownerId': self.owner, 'institution': 'Broker',
            'kind': 'holdings', 'asOf': '2026-10-18', 'identityConfirmed': 'true',
            'format': 'standard-xlsx', 'file': (io.BytesIO(content), name), **extra,
        }, headers={'Authorization': 'Bearer alice'})

    def report(self, month='2026-09', uid='alice', **extra):
        statement = {'schemaVersion': 1, 'kind': 'yieldloom-monthly-dividends', 'month': month, 'asOf': '2026-10-18',
                     'currency': 'USD', 'scopeHash': api.digest([uid, self.family, [self.account]]),
                     'accountCount': 1, 'recordCount': 2, 'unknownCount': 0, 'knownAmount': 125, 'excludedDateCount': 0}
        return {'familyId': self.family, 'accountIds': [self.account], 'currency': 'USD', 'month': month,
                'statement': statement, 'expectedRevision': 0, 'accountRevisions': {self.account: 0}, **extra}

    def shelf(self, uid='alice'):
        from urllib.parse import urlencode
        return self.get(urlencode({'view': 'statements', 'familyId': self.family, 'accountIds': json.dumps([self.account]), 'currency': 'USD'}), uid)

    def test_standard_xlsx_uses_existing_review_and_commit(self):
        file = xlsx([['date', 'symbol', 'quantity', 'amount', 'currency'], ['2026-10-18', 'AAPL', 1.5, None, 'USD']])
        response = self.sheet(file)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['source'], 'standard-xlsx-v1')
        self.assertEqual(self.commit(response.json).json['inserted'], 1)
        snapshot = self.db.data[f'investmentAccounts/{self.account}']['snapshot']
        self.assertEqual(snapshot['rows'][0]['quantity'], 1.5)
        self.assertIsNone(snapshot['rows'][0]['amount'])
        self.assertTrue(self.commit(self.sheet(file).json).json['alreadyImported'])

    def test_xlsx_rejects_formulas_large_archives_and_invalid_files(self):
        file = xlsx([['date','symbol','quantity','amount','currency'], ['2026-10-18','AAPL','=1+1',1,'USD']])
        self.assertEqual(self.sheet(file).status_code, 400)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr('xl/bomb.xml', b'0' * (20 * 1024 * 1024 + 1))
        self.assertEqual(self.sheet(archive.getvalue()).status_code, 400)
        self.assertEqual(self.sheet(b'not excel').status_code, 400)
        self.assertFalse(any('/reviews/' in path for path in self.db.data))

    def test_broker_csv_requires_explicit_mapping_and_preserves_codes(self):
        csv = '종목코드,잔고수량,평가금액\n001234,"1,000",\n'.encode('cp949')
        inspect = self.sheet(csv, 'broker.csv', 'inspectSpreadsheet', encoding='cp949')
        self.assertEqual(inspect.status_code, 200, inspect.json)
        self.assertEqual(inspect.json['rowCount'], 1)
        self.assertNotIn('rows', inspect.json)
        self.assertFalse(any('/reviews/' in path for path in self.db.data))
        mapping = json.dumps({'symbol': 0, 'quantity': 1, 'amount': 2})
        response = self.sheet(csv, 'broker.csv', format='broker-spreadsheet', broker='kiwoom', encoding='cp949', mapping=mapping, defaultCurrency='KRW')
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['source'], 'broker-mapped-v1:kiwoom')
        self.assertEqual(self.commit(response.json).json['inserted'], 1)
        self.assertEqual(self.db.data[f'investmentAccounts/{self.account}']['snapshot']['rows'][0]['symbol'], '001234')
        self.assertEqual(self.sheet(csv, 'broker.csv', format='broker-spreadsheet', encoding='cp949', mapping='{}').status_code, 400)
        self.assertEqual(self.sheet(csv, 'broker.csv', action='inspectSpreadsheet', identityConfirmed='false').status_code, 400)

    def test_broker_xlsx_transaction_mapping_dates_types_and_duplicates(self):
        file = xlsx([['거래일','코드','유형','고유번호','수량','금액','통화'], [20261018,'AAPL','매수','id-1',1,100,'USD']])
        mapping = json.dumps(dict(zip(['date','symbol','type','externalId','quantity','amount','currency'], range(7))))
        response = self.sheet(file, format='broker-spreadsheet', kind='transactions', mapping=mapping, broker='toss')
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['rows'][0]['type'], 'buy')
        self.assertEqual(response.json['rows'][0]['date'], '2026-10-18')
        self.assertEqual(self.commit(response.json).json['inserted'], 1)
        self.assertTrue(self.commit(self.sheet(file, format='broker-spreadsheet', kind='transactions', mapping=mapping, broker='toss').json).json['alreadyImported'])

    def test_private_reports_idempotency_versions_and_read_cost(self):
        body = self.report()
        response = self.post('saveMonthlyStatement', body)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.headers['X-Portfolio-Document-Reads'], '3')
        self.assertEqual(response.json['reports'][0]['revision'], 1)
        before = copy.deepcopy(self.db.data)
        self.assertTrue(self.post('saveMonthlyStatement', body).json['unchanged'])
        self.assertEqual(before, self.db.data)
        conflict = copy.deepcopy(body)
        conflict['statement']['knownAmount'] = 130
        self.assertEqual(self.post('saveMonthlyStatement', conflict).status_code, 409)
        self.db.data[f'investmentAccounts/{self.account}']['entriesRevision'] = 1
        self.assertTrue(self.shelf().json['reports'][0]['stale'])
        self.assertEqual(self.post('saveMonthlyStatement', conflict).status_code, 409)
        self.assertFalse(any('/entries/' in path for path in self.db.data))

    def test_private_reports_are_isolated_and_recheck_shared_access(self):
        self.join_bob()
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'viewer'})
        self.post('saveMonthlyStatement', self.report())
        self.assertEqual(self.shelf('bob').json['reports'], [])
        self.assertEqual(self.post('saveMonthlyStatement', self.report(uid='bob'), 'bob').status_code, 200)
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'none'})
        self.assertEqual(self.shelf('bob').status_code, 403)
        self.assertEqual(len(self.shelf().json['reports']), 1)

    def test_report_limit_and_explicit_revision_checked_delete(self):
        for year in (2024, 2025):
            for month in range(1,13):
                response = self.post('saveMonthlyStatement', self.report(f'{year}-{month:02}'))
                self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.post('saveMonthlyStatement', self.report('2026-01')).status_code, 400)
        delete = self.report('2024-01', expectedRevision=0)
        self.assertEqual(self.post('deleteMonthlyStatement', delete).status_code, 409)
        delete['expectedRevision'] = 1
        self.assertEqual(len(self.post('deleteMonthlyStatement', delete).json['reports']), 23)
        self.assertEqual(self.post('saveMonthlyStatement', self.report('2026-01')).status_code, 200)

    def test_report_delete_recreate_cannot_reuse_old_revision(self):
        body = self.report()
        first = self.post('saveMonthlyStatement', body).json['reports'][0]['revision']
        self.assertEqual(self.post('deleteMonthlyStatement', dict(body, expectedRevision=first)).status_code, 200)
        recreated = self.post('saveMonthlyStatement', body)
        self.assertGreater(recreated.json['reports'][0]['revision'], first)
        body['expectedRevision'] = first
        body['statement']['knownAmount'] = 130
        self.assertEqual(self.post('saveMonthlyStatement', body).status_code, 409)

    def test_report_rejects_malformed_scope_values_and_versions(self):
        for key, value in [('knownAmount', float('inf')), ('schemaVersion', True), ('unknownCount', 3), ('asOf', '2026-02-30')]:
            body = self.report()
            body['statement'][key] = value
            self.assertEqual(self.post('saveMonthlyStatement', body).status_code, 400)
        for change in [{'accountIds': [{}]}, {'accountIds': [self.account, self.account]}, {'accountRevisions': {self.account: True}}]:
            self.assertEqual(self.post('saveMonthlyStatement', self.report(**change)).status_code, 400 if 'accountIds' in change else 409)
        body = self.report()
        del body['statement']['knownAmount']
        self.assertEqual(self.post('saveMonthlyStatement', body).status_code, 400)
        self.assertEqual(self.sheet(xlsx([['symbol', 'quantity'], [1234567890123456, 1]])).status_code, 400)

    def test_preferences_private_and_revision_checked_without_duplicate_writes(self):
        first = self.get('view=preferences').json
        self.assertFalse(first['preferences']['enabled'])
        body = {'preferences': {'enabled': True, 'leadDays': 7, 'browser': False}, 'expectedRevision': 0}
        self.assertEqual(self.post('savePreferences', body).json['revision'], 1)
        before = copy.deepcopy(self.db.data)
        self.assertEqual(self.post('savePreferences', body).json['revision'], 1)
        self.assertEqual(before, self.db.data)
        self.assertFalse(self.get('view=preferences', 'bob').json['preferences']['enabled'])
        body['preferences']['leadDays'] = 1
        self.assertEqual(self.post('savePreferences', body).status_code, 409)
        body['expectedRevision'] = 1
        self.assertEqual(self.post('savePreferences', body).json['revision'], 2)


if __name__ == '__main__':
    unittest.main()
