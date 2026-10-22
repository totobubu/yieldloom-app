"""Restore, collect, checkpoint and report without publishing source data."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.checkpoints import R2Objects, current, restore, backup, MissingObject
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


def run(remote, root, config, run_id, bootstrap=False, transport=None, now=None):
    root = private_path(root)
    clock = now or datetime.now(timezone.utc)
    with writer_lock(root):
        if root.exists():
            raise ValueError('Scheduled root must be fresh; restore from the checkpoint each run')
        pointer, etag = current(remote)
        if pointer:
            if bootstrap:
                raise ValueError('Bootstrap cannot overwrite an existing checkpoint')
            restore(remote, root, pointer)
        elif not bootstrap:
            raise MissingObject('Explicit bootstrap required for the first collection')
        store = Store(root)
        try:
            options = {'now': clock}
            if transport:
                options['transport'] = transport
            result = collect(store, config, **options)
            result['health'] = health(store, config, clock)
            result['runId'] = run_id
            # Source failures still need durable retry state and successful-source updates.
            backup(store, remote, etag, run_id)
            result['checkpoint'] = 'saved'
            result['status'] = 'degraded' if result['failed'] or any(
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
    args = parser.parse_args()
    result = run(R2Objects(), args.root, load_registry(), args.run_id, args.bootstrap)
    print(encode(result))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as target:
            target.write(f"## Data platform: {result['status']}\n\nHTTP requests: {result['httpRequests']}; checkpoint: saved\n\n")
            for item in result['health']:
                target.write(f"- {item['sourceId']}: failures={item['failureCount']}, lastSuccess={item['lastSuccessAt']}, collectionStale={item['collectionStale']}, dataStale={item['dataStale']}\n")
    return 1 if result['status'] != 'healthy' else 0


if __name__ == '__main__':
    raise SystemExit(main())
