"""Repair direction labels only. Do not rebase any historic prices or dividends."""
import argparse
import json
from decimal import Decimal
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_pipeline.compact_history import atomic_write, sha


def repair(raw: bytes):
    text = raw.decode('utf-8-sig')
    payload = json.loads(text)
    splits = payload.get('tickerInfo', {}).get('events', {}).get('splits', [])
    changes = []
    # Only this small array is reserialized; all price/dividend tokens stay exact.
    for event in splits:
        try:
            new, old = (Decimal(part) for part in event['ratio'].split(':'))
            if not new.is_finite() or not old.is_finite() or min(new, old) <= 0 or new == old:
                continue
            correct = 'reverse-split' if new < old else 'split'
        except (KeyError, ValueError, ArithmeticError):
            continue
        if event.get('type') != correct:
            changes.append({'date': event.get('date'), 'ratio': event['ratio'], 'before': event.get('type'), 'after': correct})
            event['type'] = correct
    if not changes:
        return raw, []
    decoder = json.JSONDecoder()
    matches = []
    for match in re.finditer(r'"splits"\s*:\s*(?=\[)', text):
        value, end = decoder.raw_decode(text, match.end())
        original = payload.get('tickerInfo', {}).get('events', {}).get('splits', [])
        if isinstance(value, list) and [(e.get('date'), e.get('ratio')) for e in value] == [(e.get('date'), e.get('ratio')) for e in original]:
            matches.append((match.end(), end))
    if len(matches) != 1:
        raise ValueError('Ambiguous splits array; manual review required')
    start, end = matches[0]
    result = text[:start] + json.dumps(splits, ensure_ascii=False, separators=(',', ':')) + text[end:]
    return result.encode('utf-8'), changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'public/data')
    args = parser.parse_args()
    findings = []
    for path in sorted(args.data_dir.rglob('*.json')):
        raw = path.read_bytes()
        corrected, changes = repair(raw)
        if changes:
            findings.append({'path': str(path.relative_to(ROOT)), 'beforeSha256': sha(raw), 'afterSha256': sha(corrected), 'changes': changes})
            if args.apply:
                atomic_write(path, corrected)
    output = ROOT / 'var/data-management/split-repairs.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(findings), 'events': sum(len(f['changes']) for f in findings), 'applied': args.apply}))


if __name__ == '__main__':
    main()
