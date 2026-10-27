"""Restore, collect, checkpoint and report without publishing source data."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.checkpoints import R2Objects, current, restore, backup, MissingObject, raw_loader, ObservedObjects
from scripts.data_platform.locking import writer_lock
from scripts.data_platform.pipeline import Store, collect, encode, load_registry, private_path


def health(store, config, now):
    rows = []
    for source in config['sources']:
        if not source.get('enabled'):
            continue
        state = store.state(source['id'])
        success = state.get('lastSuccessAt')
        collection_stale = not success or now - datetime.fromisoformat(success) > timedelta(hours=48)
        dates = state.get('asOfDates', [])
        # No new filing is not a failed collection. Directory dates remain unknown.
        dated_daily = bool(set(source['datasets']) & {'holdings', 'fx', 'fund-observations'})
        data_stale = dated_daily and bool(dates) and now.date() - datetime.fromisoformat(max(dates)).date() > timedelta(days=5)
        rows.append({'sourceId': source['id'], 'lastSuccessAt': success,
            'lastCheckedAt': state.get('lastCheckedAt'), 'asOfDates': dates,
            'failureCount': state.get('failureCount', 0), 'collectionStale': collection_stale,
            'dataStale': data_stale, 'lastError': state.get('lastError')})
    return rows


def run(remote, root, config, run_id, bootstrap=False, transport=None, now=None, request_symbols=None, request_fetcher=None, request_dividends=False, write_status=False, enrich_identities=False, prepare_candidate=False):
    if request_symbols is not None:
        request_symbols=list(dict.fromkeys(str(value).strip().upper() for value in request_symbols))
        if not 1 <= len(request_symbols) <= 20 or any(not re.fullmatch(r'[A-Z0-9][A-Z0-9.-]{0,19}',value) for value in request_symbols):
            raise ValueError('Expected at most 20 valid targeted symbols')
    if (write_status or enrich_identities or prepare_candidate) and not request_symbols:
        raise ValueError('Optional collection projections require explicit targets')
    if enrich_identities or prepare_candidate:
        from scripts.data_platform.collection_scope import TARGETS
        if not set(request_symbols)<=TARGETS: raise ValueError('Outside acceptance scope')
    remote = ObservedObjects(remote)
    root = private_path(root)
    clock = now or datetime.now(timezone.utc)
    with writer_lock(root):
        if root.exists():
            raise ValueError('Scheduled root must be fresh; restore from the checkpoint each run')
        pointer, etag = current(remote)
        previous = None
        if pointer:
            if bootstrap:
                raise ValueError('Bootstrap cannot overwrite an existing checkpoint')
            previous = restore(remote, root, pointer, lazy_raw=True)
        elif not bootstrap:
            raise MissingObject('Explicit bootstrap required for the first collection')
        store = Store(root, raw_loader=raw_loader(remote, previous) if previous else None)
        initial_changes = store.db.total_changes
        try:
            status_versions = {}
            if write_status:
                for symbol in request_symbols:
                    try:
                        _, status_versions[symbol] = remote.get('market/v1/status/'+symbol+'.json')
                    except MissingObject: status_versions[symbol] = None
            options = {'now': clock}
            if transport:
                options['transport'] = transport
            active_config = {**config, 'sources': []} if request_symbols else config
            result = collect(store, active_config, **options)
            if request_symbols:
                from scripts.data_platform.request_bridge import process_requests
                catalog=json.loads((ROOT/'data-v2/catalog-seed.json').read_text())['instruments']
                if enrich_identities:
                    from scripts.data_platform.identity_enrichment import enrich_targets,effective_catalog
                    result['identityEnrichment']=enrich_targets(store,request_symbols,clock.date().isoformat(),catalog=catalog,enabled=True,now=clock)
                    catalog=effective_catalog(store,catalog)
                request_options={'fetcher':request_fetcher} if request_fetcher else {}
                result['requestedCollection']=process_requests(store,remote,request_symbols,catalog,
                    enabled=True,now=clock,dividends=request_dividends,**request_options)
            if prepare_candidate:
                from scripts.data_platform.core_candidate import build_candidate
                from scripts.data_v2.check_cutover import read_legacy
                try:
                    result['coreCandidate']=build_candidate(store,catalog,read_legacy(ROOT/'public/content-studio'),
                        request_symbols,root/'review/core-candidate',run_id,now=clock)
                except Exception:
                    # A failed candidate must not discard successful collection/checkpoint work.
                    result['coreCandidate']={'candidateBuilt':False,'readyForPublication':False,
                        'published':False,'error':'candidate_validation_failed'}
            result['health'] = health(store, active_config, clock)
            result['runId'] = run_id
            from scripts.data_platform.quality import evaluate
            result['quality'] = evaluate(store, active_config, now=clock)
            # Source failures still need durable retry state and successful-source updates.
            if not previous or previous['schemaVersion'] != 2 or store.db.total_changes != initial_changes:
                manifest = backup(store, remote, etag, run_id, previous=previous)
                result['checkpoint'] = 'saved'
            else:
                manifest = previous
                result['checkpoint'] = 'unchanged'
            old_files = {entry['path']: entry for entry in previous['files']} if previous else {}
            result['checkpointFiles'] = {entry['path']: 'reused' if old_files.get(entry['path']) == entry else 'updated'
                for entry in manifest['files'] if entry['path'] in ('observations.sqlite', 'collection.sqlite')}
            if write_status and request_symbols:
                from scripts.data_platform.collection_status import build_status,publish_status
                result['collectionStatus'] = []
                for symbol in request_symbols:
                    matches=[r for r in catalog if r['symbol']==symbol and r.get('active',True) and r.get('isin') and r.get('ipoDate')]
                    if len(matches)==1:
                        status=build_status(store,matches[0],clock.date().isoformat())
                        result['collectionStatus'].append(publish_status(remote,status,enabled=True,expected=status_versions[symbol]))
            result['r2'] = remote.metrics.copy()
            requested_failure = any(r.get('status') == 'invalid_request' for r in result.get('requestedCollection', {}).get('requests', [])) or any(j.get('status') == 'retry' for j in result.get('requestedCollection', {}).get('jobs', [])) or result.get('requestedCollection', {}).get('dividendJob', {}).get('status') == 'retry'
            result['status'] = 'degraded' if requested_failure or result['failed'] or any(r['errors'] for r in result['quality']['sources']) or any(
                r['collectionStale'] or r['dataStale'] for r in result['health']) else 'healthy'
            (root / 'review' / 'run.json').write_text(encode(result) + '\n')
            return result
        finally:
            store.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--bootstrap', action='store_true')
    parser.add_argument('--request-symbol', action='append', help='Explicitly process a targeted API outbox request; omitted by default')
    parser.add_argument('--request-dividends', action='store_true', help='Also run one official dividend backfill and its private release review')
    parser.add_argument('--write-status', action='store_true', help='Write private status projections after a targeted checkpoint; disabled by default')
    parser.add_argument('--enrich-identities', action='store_true', help='Enrich at most two already discovered target listings')
    parser.add_argument('--prepare-core-candidate', action='store_true', help='Build and validate a local private candidate only')
    args = parser.parse_args()
    if (args.request_dividends or args.write_status or args.enrich_identities or args.prepare_core_candidate) and not args.request_symbol:
        parser.error('Optional target operations require --request-symbol')
    result = run(R2Objects(), args.root, load_registry(), args.run_id, args.bootstrap, request_symbols=args.request_symbol, request_dividends=args.request_dividends, write_status=args.write_status, enrich_identities=args.enrich_identities, prepare_candidate=args.prepare_core_candidate)
    print(encode(result))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as target:
            target.write(f"## Data platform: {result['status']}\n\nHTTP requests: {result['httpRequests']}; checkpoint: {result['checkpoint']}\n\n")
            target.write(f"R2 API attempts: {encode(result['r2'])}\n\nCheckpoint files: {encode(result['checkpointFiles'])}\n\n")
            for item in result['health']:
                target.write(f"- {item['sourceId']}: failures={item['failureCount']}, lastSuccess={item['lastSuccessAt']}, collectionStale={item['collectionStale']}, dataStale={item['dataStale']}\n")
            if result['blocked']:
                target.write(f"\n### Collection permissions\n\nBlocked sources: {result['blocked']}\n\n")
                for item in result['sources']:
                    if item['status'] == 'blocked':
                        target.write(f"- {item['sourceId']}: {item['reason']}\n")
            target.write('\n### Quality review\n\n')
            for item in result['quality']['sources']:
                if item['errors'] or item['warnings']:
                    target.write(f"- {item['sourceId']}: errors={','.join(item['errors']) or 'none'}; warnings={','.join(item['warnings']) or 'none'}\n")
    return 1 if result['status'] != 'healthy' else 0


if __name__ == '__main__':
    raise SystemExit(main())
