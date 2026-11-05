import hashlib
import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from scripts.data_pipeline.dropbox_preservation import (
    DropboxArchive, DropboxSession, PreservationError, Response, TokenProvider,
    build_plan, content_hash, encode, sha,
)
from scripts.data_pipeline.extract_amount_fixed import preserve


def metadata(body, rev='1'):
    return {'size': len(body), 'content_hash': content_hash(body), 'rev': rev}


def token_response(value='fixture-access'):
    return Response(200, encode({'access_token': value, 'expires_in': 3600, 'token_type': 'bearer'}))


class TokenTests(unittest.TestCase):
    def provider(self, transport, **options):
        return TokenProvider('fixture-key', 'fixture-secret', 'fixture-refresh', transport, enabled=True, sleep=lambda _: None, **options)

    def test_default_disabled_and_invalid_grant_are_not_repeated_or_exposed(self):
        calls = []
        def denied(url, headers, body):
            calls.append(url)
            return Response(400, b'{"error":"invalid_grant","error_description":"fixture-secret fixture-refresh"}')
        disabled = TokenProvider('key', 'secret', 'refresh', denied)
        with self.assertRaisesRegex(PreservationError, '^reauthorization_required$'):
            disabled.token()
        self.assertEqual(calls, [])
        provider = self.provider(denied)
        for _ in range(5):
            with self.assertRaisesRegex(PreservationError, '^reauthorization_required$'):
                provider.token()
        self.assertEqual(len(calls), 1)
        self.assertNotIn('fixture-secret', repr(provider))
        self.assertNotIn('fixture-secret', repr(denied('', {}, b'')))

    def test_concurrent_refresh_is_single_flight_and_obeys_expiry(self):
        calls = []
        clock = [0]
        def exchange(*_):
            calls.append(1)
            time.sleep(0.01)
            return token_response('fixture-' + str(len(calls)))
        provider = self.provider(exchange, now=lambda: clock[0])
        barrier = threading.Barrier(8)
        def load(_):
            barrier.wait(timeout=2)
            return provider.token()
        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(set(pool.map(load, range(8))), {'fixture-1'})
        self.assertEqual(len(calls), 1)
        clock[0] = 3541
        self.assertEqual(provider.token(), 'fixture-2')
        self.assertEqual(len(calls), 2)
        # Another request rejected the old token after the refresh; do not refresh again.
        self.assertEqual(provider.token(rejected='fixture-1'), 'fixture-2')
        self.assertEqual(len(calls), 2)

    def test_refresh_transient_retry_is_bounded_and_exception_text_is_sanitized(self):
        calls = []
        def unavailable(*_):
            calls.append(1)
            raise TimeoutError('fixture-secret')
        provider = self.provider(unavailable)
        with self.assertRaisesRegex(PreservationError, '^token_temporarily_unavailable$'):
            provider.token()
        self.assertEqual(len(calls), 3)
        provider = self.provider(lambda *_: Response(429, b'', {'Retry-After': '120'}))
        with self.assertRaisesRegex(PreservationError, '^retry_later$'):
            provider.token()

    def test_only_expired_access_token_gets_one_refresh(self):
        refresh = []
        calls = []
        def exchange(*_):
            refresh.append(1)
            return token_response('fixture-' + str(len(refresh)))
        provider = self.provider(exchange)
        def request(url, headers, body):
            calls.append(headers['Authorization'])
            if len(calls) == 1:
                return Response(401, encode({'error': {'.tag': 'expired_access_token'}}))
            data = b'bytes'
            return Response(200, data, {'Dropbox-API-Result': json.dumps(metadata(data))})
        session = DropboxSession(provider, request)
        self.assertEqual(session.download('/test')[0], b'bytes')
        self.assertEqual(len(refresh), 2)
        self.assertEqual(len(calls), 2)
        invalid = DropboxSession(provider, lambda *_: Response(401, encode({'error': {'.tag': 'invalid_access_token'}})))
        with self.assertRaisesRegex(PreservationError, '^reauthorization_required$'):
            invalid.download('/test')
        with self.assertRaisesRegex(PreservationError, '^reauthorization_required$'):
            provider.token()
        self.assertEqual(len(refresh), 2)

    def test_content_hash_matches_block_algorithm_including_empty_input(self):
        self.assertEqual(content_hash(b''), hashlib.sha256(b'').hexdigest())
        body = b'a' * 4194304 + b'b'
        expected = hashlib.sha256(hashlib.sha256(b'a' * 4194304).digest() + hashlib.sha256(b'b').digest()).hexdigest()
        self.assertEqual(content_hash(body), expected)
        self.assertNotEqual(content_hash(body), sha(body))

    def test_read_retries_html_503_but_write_timeout_is_not_blindly_retried(self):
        provider = self.provider(lambda *_: token_response())
        calls, waits = [], []
        def transport(url, headers, body):
            calls.append(url)
            return Response(503, b'<html>failure</html>')
        session = DropboxSession(provider, transport, sleep=waits.append)
        with self.assertRaisesRegex(PreservationError, '^read_temporarily_unavailable$'):
            session.download('/test')
        self.assertEqual(len(calls), 3)
        self.assertEqual(waits, [0.25, 0.5])
        calls.clear()
        with self.assertRaisesRegex(PreservationError, '^uncertain_write$'):
            session.upload('/test', b'bytes')
        self.assertEqual(len(calls), 1)

    def test_unexpected_transport_error_is_sanitized_without_retries(self):
        calls = []
        def broken(*_):
            calls.append(1)
            raise ValueError('fixture-secret')
        with self.assertRaisesRegex(PreservationError, '^transport_adapter_failed$'):
            self.provider(broken).token()
        self.assertEqual(len(calls), 1)
        calls.clear()
        session = DropboxSession(self.provider(lambda *_: token_response()), broken)
        with self.assertRaisesRegex(PreservationError, '^transport_adapter_failed$'):
            session.download('/test')
        self.assertEqual(len(calls), 1)

    def test_upload_uses_revision_strict_conflict_and_no_autorename(self):
        seen = []
        def transport(url, headers, body):
            seen.append(json.loads(headers['Dropbox-API-Arg']))
            return Response(200, encode(metadata(body)))
        session = DropboxSession(self.provider(lambda *_: token_response()), transport)
        session.upload('/test', b'bytes', 'reviewed-rev')
        self.assertEqual(seen[0]['mode'], {'.tag': 'update', 'update': 'reviewed-rev'})
        self.assertFalse(seen[0]['autorename'])
        self.assertTrue(seen[0]['strict_conflict'])
        self.assertEqual(seen[0]['content_hash'], content_hash(b'bytes'))


class MemoryDropbox:
    def __init__(self):
        self.files, self.uploads = {}, []
        self.rev = 0
        self.fail_object = False
        self.lose_reply = False
        self.pointer_race = False

    def download(self, path):
        if path not in self.files:
            raise PreservationError('not_found')
        body, revision = self.files[path]
        return body, metadata(body, revision)

    def upload(self, path, body, revision=None):
        self.uploads.append(path)
        if self.fail_object and '/objects/' in path:
            raise PreservationError('uncertain_write')
        if self.pointer_race and path.endswith('/current.json'):
            previous, _ = self.files[path]
            self.files[path] = (previous, 'competing-rev')
        current = self.files.get(path)
        if (revision is None and current) or (revision is not None and (not current or current[1] != revision)):
            raise PreservationError('conflict')
        self.rev += 1
        self.files[path] = (body, str(self.rev))
        if self.lose_reply:
            raise PreservationError('uncertain_write')
        return metadata(body, str(self.rev))


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'sources'
        self.source.mkdir()
        self.store = MemoryDropbox()
        self.archive = DropboxArchive(self.store, allow_writes=True)
        self.fixed = {'date': '2026-01-01', 'amountFixed': '0.123400',
                      'amountOriginal': '0.246800', 'amountSplitAdjustments': [{'ratio': 2}],
                      'source': {'url': 'https://issuer.example/dividend', 'hash': 'fixture-source'}}
        self.counter = 0

    def plan(self, rows=None):
        self.counter += 1
        (self.source / 'example.json').write_text(json.dumps({'tickerInfo': {'symbol': 'EXAMPLE', 'isin': None}, 'backtestData': rows if rows is not None else [self.fixed]}))
        preservation = self.root / ('preserved-' + str(self.counter))
        preserve(self.source, preservation)
        return build_plan(self.source, preservation)

    def test_disabled_by_default_and_first_publish_reads_back_exact_evidence(self):
        plan = self.plan()
        with self.assertRaisesRegex(PreservationError, '^writes_disabled$'):
            DropboxArchive(self.store).publish(plan)
        self.assertEqual(self.store.uploads, [])
        result = self.archive.publish(plan)
        original = self.archive.read_file(result['snapshotId'], 'dividends.json')
        row = json.loads(original)['records'][0]
        self.assertEqual(row['originalRow'], {**self.fixed, 'amountSplitAdjustments': [{'ratio': '2'}]})
        source_hash = row['sourceFileSha256']
        raw = self.archive.read_file(result['snapshotId'], 'originals/' + source_hash + '.json')
        self.assertEqual(raw, (self.source / 'example.json').read_bytes())
        self.assertEqual(row['amountFixed']['raw'], '0.123400')
        self.assertEqual(self.archive.load_records()[0], row)

    def test_unchanged_is_no_write_and_history_chain_keeps_removed_observations(self):
        first = self.archive.publish(self.plan())
        count = len(self.store.uploads)
        self.assertEqual(self.archive.publish(self.plan())['status'], 'unchanged')
        self.assertEqual(len(self.store.uploads), count)
        changed = {**self.fixed, 'amountFixed': '0.130000'}
        second = self.archive.publish(self.plan([changed]))
        self.assertNotEqual(first['snapshotId'], second['snapshotId'])
        records = self.archive.load_records()
        self.assertEqual({r['amountFixed']['raw'] for r in records}, {'0.123400', '0.130000'})
        self.assertEqual(len(records), 2)  # Same symbol/date never automatically merges observations.
        self.assertEqual(json.loads(self.archive.read_file(first['snapshotId'], 'dividends.json'))['records'][0]['originalRow'], {**self.fixed, 'amountSplitAdjustments': [{'ratio': '2'}]})

    def test_failed_object_upload_keeps_current_and_all_previous_bytes(self):
        self.archive.publish(self.plan())
        pointer = self.store.files['/Yieldloom/dividends/v1/current.json']
        previous = dict(self.store.files)
        changed = self.plan([{**self.fixed, 'amountFixed': 0}])
        self.store.fail_object = True
        with self.assertRaisesRegex(PreservationError, '^immutable_write_unconfirmed$'):
            self.archive.publish(changed)
        self.assertEqual(self.store.files['/Yieldloom/dividends/v1/current.json'], pointer)
        self.assertTrue(all(self.store.files[key] == value for key, value in previous.items()))

    def test_lost_upload_responses_are_verified_without_duplicate_writes(self):
        self.store.lose_reply = True
        result = self.archive.publish(self.plan())
        self.assertEqual(result['status'], 'published')
        self.assertEqual(len(self.store.uploads), len(set(self.store.uploads)))

    def test_concurrent_pointer_update_conflicts_and_preserves_old_history(self):
        first = self.archive.publish(self.plan())
        changed = self.plan([{**self.fixed, 'amountFixed': '0.2'}])
        self.store.pointer_race = True
        with self.assertRaisesRegex(PreservationError, '^conflict$'):
            self.archive.publish(changed)
        self.assertEqual(self.archive.current()[0], first['snapshotId'])
        self.assertEqual(len(self.archive.load_records()), 1)

    def test_corruption_and_chain_limit_fail_without_returning_empty_or_partial_history(self):
        result = self.archive.publish(self.plan())
        manifest = self.archive.snapshot(result['snapshotId'])
        object_key = '/Yieldloom/dividends/v1/objects/' + manifest['files']['dividends.json']['sha256'] + '.json'
        self.store.files[object_key] = (b'{"records":[]}', 'corrupt-rev')
        with self.assertRaisesRegex(PreservationError, '^integrity_mismatch$'):
            self.archive.load_records()
        with self.assertRaisesRegex(PreservationError, '^incomplete_history_chain$'):
            self.archive.load_records(max_snapshots=0)

    def test_noop_checks_remote_integrity_and_history_read_failures_propagate(self):
        plan = self.plan()
        self.archive.publish(plan)
        key = '/Yieldloom/dividends/v1/objects/' + plan.files['dividends.json']['sha256'] + '.json'
        original = self.store.files[key]
        self.store.files[key] = (b'changed', 'different-rev')
        count = len(self.store.uploads)
        with self.assertRaisesRegex(PreservationError, '^integrity_mismatch$'):
            self.archive.publish(plan)
        self.assertEqual(len(self.store.uploads), count)
        self.store.files[key] = original
        self.store.download = lambda *_: (_ for _ in ()).throw(PreservationError('reauthorization_required'))
        with self.assertRaisesRegex(PreservationError, '^reauthorization_required$'):
            self.archive.load_records()

    def test_local_source_tampering_blocks_archive_planning_before_any_remote_call(self):
        self.plan()
        preservation = self.root / 'preserved-1'
        (self.source / 'example.json').write_text('{}')
        with self.assertRaises(ValueError):
            build_plan(self.source, preservation)
        self.assertEqual(self.store.uploads, [])


if __name__ == '__main__':
    unittest.main()
