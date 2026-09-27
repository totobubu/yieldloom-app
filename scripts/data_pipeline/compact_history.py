"""Lossless JSON compaction: no retention cutoff, rounding, or schema changes.

The archive is verified before any replacements. Numeric tokens are copied,
not reserialized, so even decimals beyond float precision remain unchanged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|\s+')
ROOT = Path(__file__).resolve().parents[2]


def compact_bytes(raw: bytes) -> bytes:
    text = raw.decode('utf-8-sig')
    # Validate before touching anything; Decimal avoids float rounding.
    json.loads(text, parse_float=Decimal)
    return (TOKEN.sub(lambda m: m[0] if m[0].startswith('"') else '', text) + '\n').encode('utf-8')


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def atomic_write(path: Path, content: bytes) -> None:
    temporary = path.with_name(path.name + '.compact.tmp')
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def compact_tree(root: Path, paths: list[Path], *, apply=False, archive: Path | None = None) -> dict:
    root = root.resolve()
    files = sorted({p.resolve() for directory in paths for p in directory.rglob('*.json')})
    entries = []
    for path in files:
        relative = path.relative_to(root).as_posix()
        raw = path.read_bytes()
        compact = compact_bytes(raw)
        payload = json.loads(raw)
        rows = payload.get('backtestData', []) if isinstance(payload, dict) else []
        dates = [r['date'] for r in rows if isinstance(r, dict) and r.get('date')]
        entries.append(dict(path=relative, beforeBytes=len(raw), afterBytes=len(compact),
                            originalSha256=sha(raw), compactSha256=sha(compact),
                            historyRows=len(rows), earliest=min(dates, default=None), latest=max(dates, default=None)))
    report = dict(createdAt=datetime.now(timezone.utc).isoformat(), files=len(entries),
                  beforeBytes=sum(e['beforeBytes'] for e in entries),
                  afterBytes=sum(e['afterBytes'] for e in entries),
                  historyRows=sum(e['historyRows'] for e in entries),
                  dateCutoff=None, applied=False, entries=entries)
    if not apply:
        return report
    if archive:
        archive = archive.resolve()
        if archive.is_relative_to(root):
            raise ValueError('Recovery archive must be outside the repository')
        archive.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            for entry in entries:
                raw = (root / entry['path']).read_bytes()
                if sha(raw) != entry['originalSha256']:
                    raise RuntimeError('Source changed during archive: ' + entry['path'])
                bundle.writestr(entry['path'], raw)
            bundle.writestr('manifest.json', json.dumps(report, ensure_ascii=False))
        with zipfile.ZipFile(archive) as bundle:
            for entry in entries:
                if sha(bundle.read(entry['path'])) != entry['originalSha256']:
                    raise RuntimeError('Archive verification failed: ' + entry['path'])
        report['archive'] = str(archive)
    # Re-read immediately before replacement; abort on concurrent writer changes.
    for entry in entries:
        path = root / entry['path']
        raw = path.read_bytes()
        if sha(raw) != entry['originalSha256']:
            raise RuntimeError('Concurrent update detected: ' + entry['path'])
        compact = compact_bytes(raw)
        if sha(compact) != entry['compactSha256']:
            raise RuntimeError('Unexpected transformation: ' + entry['path'])
        if raw != compact:
            atomic_write(path, compact)
        if sha(path.read_bytes()) != entry['compactSha256']:
            raise RuntimeError('Post-write verification failed: ' + entry['path'])
    report['applied'] = True
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paths', nargs='+', type=Path, default=[ROOT / 'public/data', ROOT / 'public/content-studio'])
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--archive', type=Path, help='New ZIP path outside the repository (initial migration)')
    parser.add_argument('--report', type=Path, default=ROOT / 'var/data-management/compaction.json')
    args = parser.parse_args()
    report = compact_tree(ROOT, args.paths, apply=args.apply, archive=args.archive)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(args.report, json.dumps(report, ensure_ascii=False, indent=2).encode('utf-8'))
    print(json.dumps({k: v for k, v in report.items() if k != 'entries'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
