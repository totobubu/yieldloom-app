"""Exercise Flask endpoints with real domain validation and a transactional in-memory store."""
import copy
import importlib.util
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

API = Path(__file__).resolve().parents[1] / 'api'
sys.path.insert(0, str(API))
from family_portfolio_service import PortfolioError, calculate_holdings, normalize_row, summarize, validate_rows
spec = importlib.util.spec_from_file_location('family_api', API / 'family-portfolio.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class Snapshot:
    def __init__(self, ref):
        self.reference, self.id = ref, ref.id
        self.data = copy.deepcopy(ref.db.data.get(ref.path))
        self.exists = self.data is not None

    def to_dict(self):
        return copy.deepcopy(self.data)


class Ref:
    def __init__(self, db, path):
        self.db, self.path, self.id = db, path, path.split('/')[-1]

    def collection(self, name):
        return Collection(self.db, self.path + '/' + name)

    def get(self, transaction=None):
        if transaction:
            assert not transaction.wrote, 'Firestore forbids reads after writes'
        return Snapshot(self)

    def set(self, data):
        self.db.data[self.path] = copy.deepcopy(data)

    def delete(self):
        self.db.data.pop(self.path, None)


class Collection:
    def __init__(self, db, path, predicate=lambda row: True, limit=10000):
        self.db, self.path, self.predicate, self.cap = db, path, predicate, limit

    def document(self, key=None):
        if key is None:
            self.db.counter += 1
            key = f'id{self.db.counter}'
        return Ref(self.db, self.path + '/' + key)

    def where(self, field, op, value):
        return Collection(self.db, self.path, lambda row: value in row[field] if op == 'array_contains' else row[field] == value)

    def order_by(self, field):
        return self

    def select(self, fields):
        query = copy.copy(self)
        query.fields = fields
        return query

    def start_after(self, snap):
        return PagedCollection(self.db, self.path, snap.reference.path)

    def limit(self, count):
        query = copy.copy(self)
        query.cap = count
        return query

    def stream(self):
        paths = [path for path, value in sorted(self.db.data.items()) if path.rsplit('/', 1)[0] == self.path and self.predicate(value)]
        snapshots = [Snapshot(Ref(self.db, path)) for path in paths[:self.cap]]
        if hasattr(self, 'fields'):
            for snap in snapshots:
                snap.data = {field: snap.data[field] for field in self.fields if field in snap.data}
        return iter(snapshots)


class PagedCollection(Collection):
    def __init__(self, db, path, after):
        super().__init__(db, path)
        self.after = after

    def limit(self, count):
        self.cap = count
        return self

    def stream(self):
        snapshots = [Snapshot(Ref(self.db, path)) for path in sorted(self.db.data) if path.rsplit('/', 1)[0] == self.path and path > self.after][:self.cap]
        if hasattr(self, 'fields'):
            for snap in snapshots:
                snap.data = {field: snap.data[field] for field in self.fields if field in snap.data}
        return iter(snapshots)


class Transaction:
    def __init__(self):
        self.wrote = False

    def set(self, ref, value):
        self.wrote = True
        ref.set(value)

    def delete(self, ref):
        self.wrote = True
        ref.delete()


class Store:
    def __init__(self):
        self.data, self.counter = {}, 0

    def collection(self, path):
        return Collection(self, path)

    def transaction(self):
        return Transaction()


class FamilyApiTest(unittest.TestCase):
    def setUp(self):
        self.db = Store()
        self.client = api.app.test_client()
        self.patches = [patch.object(api, 'database', return_value=self.db),
                        patch.object(api.auth, 'verify_id_token', side_effect=lambda token, **kw: {'uid': token}),
                        patch.object(api.firestore, 'transactional', side_effect=lambda f: f)]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        self.family = self.post('createFamily', {'name': 'Family', 'profileName': 'Adult'}).json['familyId']
        self.owner = next(iter(self.db.data[f'familySpaces/{self.family}']['profiles']))
        self.account = self.new_account()

    def post(self, action, body, uid='alice'):
        return self.client.post('/api/family-portfolio?action=' + action, json=body, headers={'Authorization': 'Bearer ' + uid})

    def get(self, query, uid='alice'):
        return self.client.get('/api/family-portfolio?' + query, headers={'Authorization': 'Bearer ' + uid})

    def new_account(self, owner=None, uid='alice'):
        result = self.post('createAccount', {'familyId': self.family, 'ownerId': owner or self.owner, 'institution': 'Broker', 'alias': 'One', 'type': 'general', 'last4': '1234'}, uid)
        self.assertEqual(result.status_code, 200, result.json)
        return result.json['accountId']

    def join_bob(self):
        token = self.post('invite', {'familyId': self.family}).json['invitation']
        body = {'invitation': token, 'name': 'Bob'}
        self.assertEqual(self.post('join', body, 'bob').status_code, 200)
        self.assertEqual(self.post('join', body, 'carol').status_code, 404)
        return next(key for key, value in self.db.data[f'familySpaces/{self.family}']['profiles'].items() if value.get('uid') == 'bob')

    def preview(self, content, kind='transactions', account=None, uid='alice', **extra):
        return self.client.post('/api/family-portfolio?action=preview', data={
            'accountId': account or self.account, 'institution': 'Broker', 'ownerId': self.owner, 'kind': kind,
            'asOf': '2026-10-15', 'identityConfirmed': 'true', 'file': (io.BytesIO(content), 'statement.csv'), **extra}, headers={'Authorization': 'Bearer ' + uid})

    def commit(self, review, account=None, uid='alice'):
        return self.post('commit', {'accountId': account or self.account, 'reviewId': review['reviewId'], 'rows': review['rows']}, uid)

    def manual(self, rows=None, as_of='2026-10-16', uid='alice', **extra):
        old = self.db.data[f'investmentAccounts/{self.account}'].get('snapshot')
        body = {'accountId': self.account, 'asOf': as_of,
                'baseSnapshot': {key: old.get(key) for key in ('asOf', 'importedAt')} if old else None,
                'identityConfirmed': True, 'completeSnapshotConfirmed': True,
                'rows': rows if rows is not None else [{'date': as_of, 'symbol': 'aapl', 'quantity': 1.25, 'amount': None, 'currency': 'usd'}]}
        return self.post('previewManualHoldings', {**body, **extra}, uid)

    def test_manual_holdings_source_validation_and_idempotent_commit(self):
        content = b'date,symbol,quantity,amount,currency,type,externalId\n2026-10-15,AAPL,1,100,USD,buy,existing-buy\n'
        self.commit(self.preview(content).json)
        entries_before = {key: value for key, value in self.db.data.items() if '/entries/' in key}
        response = self.manual()
        self.assertEqual(response.headers['X-Portfolio-Document-Reads'], '2')
        self.assertEqual(response.headers['X-Portfolio-Read-Operations'], '2')
        review = response.json
        self.assertEqual(review['source'], 'manual-holdings-v1')
        self.assertEqual(review['rows'][0]['symbol'], 'AAPL')
        self.assertEqual(self.commit(review).json['inserted'], 1)
        self.assertTrue(self.commit(review).json['alreadyImported'])
        snapshot = self.db.data[f'investmentAccounts/{self.account}']['snapshot']
        self.assertEqual(snapshot['source'], 'manual-holdings-v1')
        self.assertIsNone(snapshot['rows'][0]['amount'])
        self.assertEqual({key: value for key, value in self.db.data.items() if '/entries/' in key}, entries_before)
        self.assertEqual(self.manual(as_of='2026-10-16').status_code, 409)
        self.assertEqual(self.manual(as_of='2026-10-15').status_code, 409)

    def test_same_date_correction_preserves_history_and_is_idempotent(self):
        initial = self.manual().json
        self.assertEqual(self.commit(initial).status_code, 200)
        before = copy.deepcopy(self.db.data[f'investmentAccounts/{self.account}']['snapshot'])
        changed = [{'date': '2026-10-16', 'symbol': 'AAPL', 'quantity': 2, 'amount': 400, 'currency': 'USD'}]
        self.assertEqual(self.manual(rows=changed, correction=True).status_code, 400)
        self.assertEqual(self.manual(rows=changed, correction=True, correctionReason='수량 정정', as_of='2026-10-17').status_code, 409)
        self.assertEqual(self.manual(correction=True, correctionReason='변경 없음').status_code, 400)
        review = self.manual(rows=changed, correction=True, correctionReason='수량 정정').json
        saved = self.commit(review)
        self.assertEqual(saved.status_code, 200, saved.json)
        # Same pre-existing account/read/review/receipt path; no extra DB reads.
        self.assertEqual(saved.headers['X-Portfolio-Document-Reads'], '9')
        self.assertTrue(self.commit(review).json['alreadyImported'])
        current = self.db.data[f'investmentAccounts/{self.account}']['snapshot']
        self.assertEqual(current['rows'][0]['quantity'], 2)
        self.assertEqual(current['revision'], 2)
        self.assertNotIn('previous', current)
        history = self.get(f'accountId={self.account}&view=snapshotHistory')
        self.assertEqual(history.status_code, 200)
        self.assertEqual(len(history.json['snapshots']), 2)
        self.assertTrue(all('rows' not in row and 'previous' not in row for row in history.json['snapshots']))
        corrected = next(row for row in history.json['snapshots'] if row['revision'] == 2)
        detail = self.get(f'accountId={self.account}&view=snapshotHistory&snapshotId={corrected["id"]}').json['snapshot']
        self.assertEqual(detail['previous'], before)
        self.assertEqual(detail['correctionReason'], '수량 정정')
        self.assertEqual(detail['changedBy'], 'alice')
        self.assertEqual(detail['rows'][0]['quantity'], 2)
        self.assertEqual(self.get(f'accountId={self.account}&view=snapshotHistory', 'outsider').status_code, 403)

    def test_correction_rechecks_concurrent_changes_and_permissions(self):
        self.commit(self.manual().json)
        changed = [{'date': '2026-10-16', 'symbol': 'AAPL', 'quantity': 2, 'amount': 400, 'currency': 'USD'}]
        a = self.manual(rows=changed, correction=True, correctionReason='첫 정정').json
        b = self.manual(rows=changed, correction=True, correctionReason='경합 정정').json
        self.assertEqual(self.commit(a).status_code, 200)
        self.assertEqual(self.commit(b).status_code, 409)
        self.join_bob()
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'editor'})
        changed[0]['quantity'] = 3
        review = self.manual(rows=changed, correction=True, correctionReason='권한 확인', uid='bob').json
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'viewer'})
        self.assertEqual(self.commit(review, uid='bob').status_code, 403)
        self.assertEqual(self.manual(rows=changed, correction=True, correctionReason='읽기 전용', uid='bob').status_code, 403)
        self.assertEqual(self.get(f'accountId={self.account}&view=snapshotHistory', 'bob').status_code, 200)
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'none'})
        self.assertEqual(self.get(f'accountId={self.account}&view=snapshotHistory', 'bob').status_code, 403)

    def test_snapshot_history_paginates_and_rejects_foreign_detail_ids(self):
        for i in range(23):
            self.db.data[f'investmentAccounts/{self.account}/snapshots/snapshot{i:02}'] = {
                'asOf': '2026-10-16', 'rows': [], 'revision': i, 'previous': {'rows': []}}
        first = self.get(f'accountId={self.account}&view=snapshotHistory').json
        second = self.get(f'accountId={self.account}&view=snapshotHistory&cursor={first["nextCursor"]}').json
        self.assertEqual(len(first['snapshots']), 20)
        self.assertEqual(len(second['snapshots']), 3)
        self.assertIsNone(second['nextCursor'])
        self.assertTrue(all('rows' not in row and 'previous' not in row for row in first['snapshots'] + second['snapshots']))
        self.assertEqual(self.get(f'accountId={self.account}&view=snapshotHistory&snapshotId=missing').status_code, 404)
        self.assertEqual(self.get(f'accountId={self.account}&view=snapshotHistory&cursor=missing').status_code, 400)

    def test_manual_holdings_requires_complete_confirmation_valid_rows_and_editor(self):
        self.assertEqual(self.manual(completeSnapshotConfirmed=False).status_code, 400)
        self.assertEqual(self.manual(identityConfirmed=False).status_code, 400)
        self.assertEqual(self.manual(rows=[]).status_code, 400)
        row = {'date': '2026-10-16', 'symbol': 'AAPL', 'quantity': -1, 'amount': None, 'currency': 'USD'}
        self.assertEqual(self.manual(rows=[row]).status_code, 400)
        row['quantity'] = 1
        self.assertEqual(self.manual(rows=[row, row]).status_code, 400)
        self.assertEqual(self.manual(rows=[row] * 201).status_code, 400)
        self.join_bob()
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'viewer'})
        self.assertEqual(self.manual(uid='bob').status_code, 403)
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'editor'})
        review = self.manual(uid='bob').json
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'viewer'})
        self.assertEqual(self.commit(review, uid='bob').status_code, 403)

    def test_manual_holdings_rejects_stale_preview_and_concurrent_snapshot(self):
        first = self.manual().json
        second = self.manual(as_of='2026-10-17').json
        self.assertEqual(self.commit(first).status_code, 200)
        self.assertEqual(self.commit(second).status_code, 409)
        self.assertEqual(self.manual(as_of='2026-10-18', baseSnapshot=None).status_code, 409)
        self.assertEqual(self.manual(as_of='2026-10-18').status_code, 200)

    def test_personal_account_setup_is_repeatable_and_private(self):
        first = self.post('ensurePersonal', {'profileName': 'Alice'})
        second = self.post('ensurePersonal', {'profileName': 'Different'})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json, second.json)
        space = self.db.data['familySpaces/' + first.json['familyId']]
        self.assertEqual(space['kind'], 'personal')
        self.assertEqual(space['participantUids'], ['alice'])
        self.assertEqual(list(space['profiles'].values())[0]['name'], 'Alice')
        self.assertEqual(self.get('familyId=' + first.json['familyId'], 'bob').status_code, 403)

    def test_authentication_and_cross_family_denied(self):
        self.assertEqual(self.client.get('/api/family-portfolio').status_code, 401)
        self.assertEqual(self.get('familyId=' + self.family, 'outsider').status_code, 403)
        self.assertEqual(self.get('accountId=' + self.account, 'outsider').status_code, 403)
        self.assertEqual(self.post('grant', {'accountId': self.account, 'uid': 'outsider', 'role': 'viewer'}).status_code, 400)

    def test_ledger_validation_omits_holdings_and_counts_server_reads(self):
        row = self.db.data['investmentAccounts/' + self.account]
        row['entriesRevision'] = 3
        row['snapshot'] = {'rows': [{'symbol': 'PRIVATE'}]}
        response = self.get('familyId=' + self.family + '&view=ledger')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json), {'accounts'})
        self.assertNotIn('snapshot', response.json['accounts'][0])
        self.assertEqual(response.json['accounts'][0]['entriesRevision'], 3)
        self.assertEqual(response.headers['X-Portfolio-Document-Reads'], '2')
        self.assertEqual(response.headers['X-Portfolio-Read-Operations'], '2')
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        self.assertEqual(self.get('familyId=' + self.family + '&view=ledger', 'outsider').status_code, 403)

    def test_full_overview_reuses_membership_query_without_rereading_the_family(self):
        response = self.get('familyId=' + self.family)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['X-Portfolio-Document-Reads'], '2')
        self.assertEqual(response.headers['X-Portfolio-Read-Operations'], '2')
        self.assertEqual(self.get('familyId=invalid.value').status_code, 400)

    def test_entry_page_read_metrics_include_permissions_and_do_not_leak_identifiers(self):
        collection = self.db.collection('investmentAccounts').document(self.account).collection('entries')
        for i in range(201):
            collection.document(f'e{i:03}').set({'row': {'amount': i}})
        first = self.get('accountId=' + self.account)
        self.assertEqual(first.headers['X-Portfolio-Document-Reads'], '203')
        self.assertEqual(first.headers['X-Portfolio-Read-Operations'], '3')
        second = self.get('accountId=' + self.account + '&cursor=' + first.json['nextCursor'])
        self.assertEqual(second.headers['X-Portfolio-Document-Reads'], '4')
        self.assertEqual(second.headers['X-Portfolio-Read-Operations'], '4')
        self.assertEqual(self.client.get('/api/family-portfolio').headers['X-Portfolio-Document-Reads'], '0')

    def test_transaction_batch_read_metrics_include_missing_document_snapshots(self):
        content = b'date,symbol,quantity,amount,currency,type,externalId\n2026-10-14,AAPL,2,100,USD,buy,t1\n2026-10-14,AAPL,3,150,USD,buy,t2\n'
        review = self.preview(content).json
        with patch.object(self.db, 'get_all', create=True,
                          side_effect=lambda refs, transaction: [ref.get(transaction) for ref in refs]):
            response = self.commit(review)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['X-Portfolio-Document-Reads'], '13')
        self.assertEqual(response.headers['X-Portfolio-Read-Operations'], '11')

    def test_family_admin_does_not_inherit_adult_accounts(self):
        bob = self.join_bob()
        baccount = self.new_account(bob, 'bob')
        self.assertEqual(self.get('accountId=' + baccount).status_code, 403)
        overview = self.get('familyId=' + self.family).json
        self.assertEqual([a['id'] for a in overview['accounts']], [self.account])
        self.assertEqual(self.post('createAccount', {'familyId': self.family, 'ownerId': bob, 'institution': 'X', 'alias': 'X', 'type': 'general'}).status_code, 403)
        self.assertEqual(self.post('grant', {'accountId': baccount, 'uid': 'alice', 'role': 'viewer'}, 'bob').status_code, 200)
        self.assertEqual(self.get('accountId=' + baccount).status_code, 200)
        self.assertEqual(self.post('renameAccount', {'accountId': baccount, 'alias': 'Steal'}).status_code, 403)

    def test_minor_guardian_and_masking(self):
        self.join_bob()
        self.assertEqual(self.post('addMinor', {'familyId': self.family, 'name': 'Child', 'guardianAttestation': False}).status_code, 400)
        self.post('addMinor', {'familyId': self.family, 'name': 'Child', 'guardianAttestation': True})
        child = next(key for key, value in self.db.data[f'familySpaces/{self.family}']['profiles'].items() if value['kind'] == 'minor')
        acc = self.new_account(child)
        self.assertEqual(self.db.data[f'investmentAccounts/{acc}']['maskedNumber'], '****1234')
        self.assertEqual(self.post('createAccount', {'familyId': self.family, 'ownerId': child}, 'bob').status_code, 403)

    def test_repeat_file_overlapping_transactions_and_distinct_accounts(self):
        content = b'date,symbol,quantity,amount,currency,type,externalId\n2026-10-14,AAPL,2,100,USD,buy,t1\n'
        first = self.preview(content).json
        self.assertEqual(self.commit(first).json['inserted'], 1)
        self.assertEqual(self.db.data[f'investmentAccounts/{self.account}']['entriesRevision'], 1)
        self.assertTrue(self.commit(self.preview(content).json).json['alreadyImported'])
        self.assertEqual(self.db.data[f'investmentAccounts/{self.account}']['entriesRevision'], 1)
        overlap = content + b'2026-10-15,AAPL,3,150,USD,buy,t2\n'
        result = self.commit(self.preview(overlap).json).json
        self.assertEqual(result, {'inserted': 1, 'duplicates': 1})
        self.assertEqual(self.db.data[f'investmentAccounts/{self.account}']['entriesRevision'], 2)
        other = self.new_account()
        self.assertEqual(self.commit(self.preview(content, account=other).json, account=other).json['inserted'], 1)
        self.assertEqual(len(self.get('accountId=' + self.account).json['entries']), 2)

    def test_invalid_row_is_reported_correctable_and_never_silently_saved(self):
        invalid = b'date,symbol,quantity,amount,currency,type,externalId\n2026-02-30,AAPL,2,100,USD,buy,t1\n'
        review = self.preview(invalid).json
        self.assertEqual(review['errors'][0]['row'], 1)
        self.assertEqual(self.commit(review).status_code, 400)
        self.assertEqual(self.get('accountId=' + self.account).json['entries'], [])
        review['rows'][0]['date'] = '2026-10-14'
        self.assertEqual(self.commit(review).json['inserted'], 1)
        mismatch = invalid.replace(b'2026-02-30', b'2026-10-14').replace(b',100,', b',200,')
        self.assertEqual(self.commit(self.preview(mismatch).json).status_code, 409)

    def test_permissions_rechecked_on_commit_and_expired_preview(self):
        self.join_bob()
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'editor'})
        content = b'date,symbol,quantity,amount,currency,type,externalId\n2026-10-14,AAPL,2,100,USD,buy,t1\n'
        review = self.preview(content, uid='bob').json
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'none'})
        self.assertEqual(self.commit(review, uid='bob').status_code, 403)
        own = self.preview(content).json
        path = f"investmentAccounts/{self.account}/reviews/{own['reviewId']}"
        self.db.data[path]['expiresAt'] = api.now() - api.timedelta(hours=2)
        self.assertEqual(self.commit(own).status_code, 410)

    def test_upload_identity_size_and_format(self):
        self.assertEqual(self.preview(b'abc', identityConfirmed='false').status_code, 400)
        self.assertEqual(self.preview(b'abc', ownerId='somebody').status_code, 400)
        self.assertEqual(self.preview(b'abc').status_code, 400)
        self.assertEqual(self.preview(b'x' * (2 * 1024 * 1024 + 1)).status_code, 413)
        self.assertEqual(self.preview(b'x' * (3 * 1024 * 1024 + 1)).status_code, 413)

    def test_snapshot_baselines_dates_and_no_holdings_from_transactions(self):
        content = b'date,symbol,quantity,amount,currency\n2026-10-15,AAPL,10,2000,USD\n'
        self.assertEqual(self.commit(self.preview(content, 'holdings').json).json['inserted'], 1)
        second = self.new_account()
        data = self.get('familyId=' + self.family).json['summary']
        self.assertEqual(data['knownValueByCurrency'], {'USD': 2000})
        self.assertEqual(data['missingSnapshotAccounts'], [second])
        older = content.replace(b'2026-10-15', b'2026-10-14')
        preview = self.preview(older, 'holdings', account=second, asOf='2026-10-14').json
        self.commit(preview, account=second)
        data = self.get('familyId=' + self.family).json['summary']
        self.assertTrue(data['mixedDates'])
        self.assertEqual(len(data['positions']), 2)
        self.assertEqual(data['knownValueByCurrency'], {'USD': 4000})
        conflict = content.replace(b',2000,', b',3000,')
        self.assertEqual(self.commit(self.preview(conflict, 'holdings').json).status_code, 409)

    def test_viewer_cannot_upload_and_review_cannot_cross_accounts(self):
        self.join_bob()
        self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'viewer'})
        content = b'date,symbol,quantity,amount,currency,type,externalId\n2026-10-14,AAPL,2,100,USD,buy,t1\n'
        self.assertEqual(self.preview(content, uid='bob').status_code, 403)
        review = self.preview(content).json
        other = self.new_account()
        self.assertEqual(self.commit(review, account=other).status_code, 404)
        self.assertIn('no-store', self.get('familyId=' + self.family).headers['Cache-Control'])

    def test_transaction_pagination_keeps_all_rows_account_scoped(self):
        root = f'investmentAccounts/{self.account}/entries'
        for index in range(205):
            self.db.data[f'{root}/entry{index:03}'] = {'row': {'date': '2026-10-15'}}
        first = self.get('accountId=' + self.account).json
        self.assertEqual(len(first['entries']), 200)
        second = self.get('accountId=' + self.account + '&cursor=' + first['nextCursor']).json
        self.assertEqual(len(second['entries']), 5)
        self.assertIsNone(second['nextCursor'])
        self.assertEqual(self.get('accountId=' + self.account + '&cursor=missing').status_code, 400)

    def test_non_destructive_repeatable_legacy_migration(self):
        path = 'portfolios/alice/assets/A/transactions/T'
        self.db.data['portfolios/alice/assets/A'] = {'symbol': 'AAPL', 'holdingShares': 10}
        self.db.data[path] = {'date': '20261014', 'amount': 200}
        original = copy.deepcopy(self.db.data[path])
        body = {'accountId': self.account, 'confirmedSingleAccount': True}
        self.assertEqual(self.post('migrateLegacy', body).json['transactions'], 1)
        self.assertEqual(self.post('migrateLegacy', body).status_code, 200)
        self.assertEqual(self.db.data[path], original)
        self.assertEqual(len(self.get('accountId=' + self.account + '&legacy=true').json['entries']), 1)
        self.assertEqual(self.get('familyId=' + self.family).json['summary']['positions'], [])


    def test_large_pdf_batches_retry_without_duplicates_and_validate_all_rows(self):
        rows = [{'date': '2026-10-15', 'symbol': 'CASH', 'quantity': None, 'amount': 100, 'currency': 'KRW',
                 'type': 'cash_in', 'externalId': f'pdf-{i}'} for i in range(405)]
        with patch.object(api, 'pdf_rows', return_value=rows):
            review = self.preview(b'%PDF-1.4', file=(io.BytesIO(b'%PDF-1.4'), 'statement.pdf'), format='toss-pdf', password='123456').json
        self.assertEqual(len(review['batches']), 3)
        invalid = copy.deepcopy(rows);invalid[-1]['amount'] = -1
        payload = {'accountId': self.account, 'reviewId': review['reviewId'], 'rows': invalid}
        self.assertEqual(self.post('validateImport', payload).status_code, 400)
        payload['rows'] = rows
        self.assertEqual(self.post('validateImport', payload).status_code, 200)
        for batch in review['batches']:
            part = {**review, 'reviewId': batch['reviewId'], 'rows': rows[batch['start']:batch['start'] + batch['count']]}
            self.assertEqual(self.commit(part).json['inserted'], len(part['rows']))
            self.assertTrue(self.commit(part).json['alreadyImported'])
        self.assertEqual(len(list(self.db.collection(f'investmentAccounts/{self.account}/entries').stream())), 405)

    def test_pdf_default_is_encrypted_scoped_owner_only_and_never_returned(self):
        from cryptography.hazmat.primitives.asymmetric import rsa
        from api.portfolio_pdf_secret import open_password
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        with patch('api.portfolio_pdf_secret._key', return_value=private):
            result = self.post('pdfPassword', {'accountId': self.account, 'password': '123456'})
            self.assertEqual(result.json, {'configured': True})
            path = f'investmentAccounts/{self.account}/secrets/tossPdfPassword'
            envelope = self.db.data[path]['envelope']
            self.assertNotIn('123456', str(envelope))
            self.assertEqual(open_password(envelope, 'toss:' + self.account), '123456')
            with self.assertRaises(Exception):
                open_password(envelope, 'toss:other-account')
            self.join_bob()
            self.post('grant', {'accountId': self.account, 'uid': 'bob', 'role': 'editor'})
            self.assertEqual(self.post('pdfPassword', {'accountId': self.account, 'password': '123456'}, 'bob').status_code, 403)
            with patch.object(api, 'pdf_rows', return_value=[{'date': '2026-10-15', 'symbol': 'CASH', 'quantity': None, 'amount': 100, 'currency': 'KRW', 'type': 'cash_in', 'externalId': 'default-pwd'}]) as parser:
                response = self.preview(b'%PDF-1.4', file=(io.BytesIO(b'%PDF-1.4'), 'statement.pdf'), format='toss-pdf')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(parser.call_args.args[1], '123456')
                self.assertNotIn('123456', response.get_data(as_text=True))
            self.assertNotIn('envelope', self.get('familyId=' + self.family).get_data(as_text=True))
            self.assertEqual(self.post('pdfPassword', {'accountId': self.account, 'remove': True}).json, {'configured': False})
            self.assertNotIn(path, self.db.data)

    def test_database_quota_failure_is_not_an_empty_account_list(self):
        with patch.object(api, 'database', side_effect=api.ResourceExhausted('Quota exceeded.')):
            response = self.get('')
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json['code'], 'DATA_RESOURCE_EXHAUSTED')
        self.assertEqual(response.headers['Retry-After'], '60')
        self.assertEqual(response.json['retryAfterSeconds'], 60)
        self.assertEqual(response.json['retryTiming'], 'recommended')
        self.assertEqual(response.json['limitType'], 'unknown')
        self.assertNotIn('accounts', response.json)
        self.assertIn('기존 계좌와 거래내역은 유지됩니다', response.json['error'])

    def test_entry_void_restore_and_request_id_are_audited(self):
        content = b'date,symbol,quantity,amount,currency,type,externalId\n2026-10-15,AAPL,2,100,USD,buy,trade-1\n'
        self.assertEqual(self.commit(self.preview(content).json).status_code, 200)
        entry_id = next(path.rsplit('/', 1)[-1] for path in self.db.data if f'investmentAccounts/{self.account}/entries/' in path)
        body = {'accountId': self.account, 'requestId': 'void1', 'operation': 'void',
                'entryId': entry_id, 'reason': '중복 거래'}
        result = self.post('mutateEntry', body)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json['calculatedSnapshot']['rows'], [])
        self.assertTrue(self.post('mutateEntry', body).json['alreadyApplied'])
        restore = {**body, 'requestId': 'restore1', 'operation': 'restore', 'reason': '취소 복원'}
        result = self.post('mutateEntry', restore)
        self.assertEqual(result.json['calculatedSnapshot']['rows'][0]['quantity'], 2)
        audits = [value for path, value in self.db.data.items() if '/entryCorrections/' in path]
        self.assertEqual([item['operation'] for item in audits], ['void', 'restore'])


class DomainTest(unittest.TestCase):
    def test_materialized_holdings_use_baseline_and_flag_unsafe_rows(self):
        baseline = {'asOf': '2026-10-10', 'rows': [
            {'symbol': 'AAPL', 'currency': 'USD', 'quantity': 5, 'amount': 500}]}
        entries = [
            {'id': 'old', 'row': {'date': '2026-10-10', 'symbol': 'AAPL', 'currency': 'USD', 'quantity': 99, 'type': 'buy'}},
            {'id': 'buy', 'row': {'date': '2026-10-11', 'symbol': 'AAPL', 'currency': 'USD', 'quantity': 2, 'type': 'buy'}},
            {'id': 'sell', 'row': {'date': '2026-10-12', 'symbol': 'AAPL', 'currency': 'USD', 'quantity': 1, 'type': 'sell'}},
            {'id': 'split', 'row': {'date': '2026-10-13', 'symbol': 'AAPL', 'currency': 'USD', 'quantity': 2, 'type': 'split'}},
        ]
        result = calculate_holdings(entries, baseline, 4, 1)
        self.assertEqual(result['rows'][0]['quantity'], 6)
        self.assertEqual(result['mode'], 'anchored')
        self.assertEqual(result['status'], 'needs_review')
        self.assertEqual(result['entriesRevision'], 4)

    def test_corporate_actions_and_transfer_events_do_not_generate_valuation(self):
        for kind in ['transfer_in', 'transfer_out', 'dividend', 'cash_in', 'cash_out', 'split']:
            normalize_row({'date': '2026-10-15', 'symbol': 'CASH', 'quantity': '2', 'amount': '', 'currency': 'KRW', 'type': kind, 'externalId': kind}, 'transactions')
        self.assertEqual(summarize([{'id': 'A', 'ownerId': 'P'}])['knownValueByCurrency'], {})

    def test_pdf_unparsed_rows_remain_visible_and_block_commit(self):
        with patch('api.toss_extractor.extract_transactions_from_pdf', return_value={
                'transactions': [], 'rejected_rows': [{'page': 2, 'line': 3, 'date': '2026.10.15'}]}):
            rows = api.pdf_rows(b'%PDF-1.4', '')
        self.assertEqual(len(rows), 1)
        self.assertTrue(validate_rows(rows, 'transactions', '2026-10-15')[1])

        rows[0].update({'symbol': None, 'date': '2026-10-15', 'type': 'buy', 'amount': 10})
        self.assertTrue(validate_rows(rows, 'transactions', '2026-10-15')[1])

    def test_infinite_numbers_invalid_dates_and_duplicate_trade_ids(self):
        base = {'date': '2026-10-15', 'symbol': 'AAPL', 'quantity': 'NaN', 'amount': '', 'currency': 'USD', 'type': 'buy', 'externalId': 'x'}
        with self.assertRaises(PortfolioError):
            normalize_row(base, 'transactions')
        base['quantity'] = '2'
        self.assertTrue(validate_rows([base, base], 'transactions', '2026-10-15')[1])


if __name__ == '__main__':
    unittest.main()
