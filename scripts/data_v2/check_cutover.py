"""Block dividend cutover when a validated core release loses legacy history.

Legacy records are comparison evidence only; this tool never imports them into
an approved release or upgrades their verification status.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APPROVED = {'official', 'cross_checked'}


def identity(row: dict) -> tuple[str, str, str]:
    return row['provider'], row['ticker'], row['exDate']


def compare(legacy: list[dict], core: list[dict]) -> dict:
    before, after, duplicates = {}, {}, []
    for target, rows, source in ((before, legacy, 'legacy'), (after, core, 'core')):
        for row in rows:
            if row.get('verificationStatus') not in APPROVED:
                continue
            key = identity(row)
            if key in target:
                duplicates.append({'source': source, 'identity': key})
            target[key] = row
    missing = [before[key] for key in sorted(before.keys() - after.keys())]
    changed = []
    for key in sorted(before.keys() & after.keys()):
        old, new = before[key], after[key]
        fields = [field for field in ('amount', 'currency', 'declaredDate', 'recordDate', 'payableDate')
                  if old.get(field) is not None and old.get(field) != new.get(field)]
        if fields:
            changed.append({'identity': key, 'fields': fields, 'before': old, 'after': new})
    return {'ready': bool(before) and not (missing or changed or duplicates),
            'summary': {'legacyVerifiedEvents': len(before), 'coreVerifiedEvents': len(after),
                        'missing': len(missing), 'changed': len(changed), 'duplicates': len(duplicates),
                        'new': len(after.keys() - before.keys())},
            'missing': missing, 'changed': changed, 'duplicates': duplicates}


def read_legacy(root: Path) -> list[dict]:
    index = json.loads((root / 'distribution-index.json').read_text())
    events = []
    for entry in index['tickers']:
        path = root / f"distribution-ticker-{entry['ticker'].lower()}.json"
        payload = json.loads(path.read_text())
        if payload['ticker'] != entry['ticker']:
            raise ValueError(f'Legacy ticker identity mismatch: {path}')
        for row in payload['history']:
            events.append({'provider': row['provider_slug'], 'ticker': row['ticker'],
                           'amount': row['distribution_per_share'], 'currency': row.get('currency'),
                           'declaredDate': row.get('declared_date'), 'exDate': row['ex_date'],
                           'recordDate': row.get('record_date'), 'payableDate': row.get('payable_date'),
                           'verificationStatus': row.get('verification_status')})
    return events


def read_core(root: Path) -> list[dict]:
    manifest = json.loads((root / 'manifest.json').read_text())
    events = []
    for entry in manifest['files']:
        if not entry['path'].startswith('tickers/'):
            continue
        for row in json.loads((root / entry['path']).read_text())['events']:
            events.append({**row, 'amount': row['amount']['raw'], 'currency': row['amount']['currency']})
    return events


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data-v2')
    parser.add_argument('--legacy-dir', type=Path, default=ROOT / 'public/content-studio')
    parser.add_argument('--output', type=Path, default=ROOT / 'tmp/dividend-cutover.json')
    args = parser.parse_args()
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/data_v2/validate_snapshot.py'),
                             '--data-dir', str(args.data_dir)], capture_output=True, text=True)
    legacy = read_legacy(args.legacy_dir)
    report = compare(legacy, read_core(args.data_dir) if result.returncode == 0 else [])
    report['snapshotValid'] = result.returncode == 0
    report['validation'] = (result.stdout + result.stderr).strip()
    report['ready'] = report['ready'] and report['snapshotValid']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ready': report['ready'], 'snapshotValid': report['snapshotValid'], **report['summary']}))
    return 0 if report['ready'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
