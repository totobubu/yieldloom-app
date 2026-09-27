"""Safely apply an upstream generated-data snapshot without a Git merge.

This is deliberately conservative: a file is replaced only when the local
JSON is semantically equal to the merge-base (or differs solely by the split
direction-label repair).  Everything else is reported as a conflict and left
untouched.  Price/dividend history is never truncated.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_pipeline.compact_history import atomic_write, compact_bytes, sha
from scripts.data_pipeline.repair_split_types import repair


def git(*args: str, text: bool = True) -> str | bytes:
    return subprocess.check_output(['git', *args], cwd=ROOT, text=text)


class BlobReader:
    """One persistent cat-file process avoids thousands of Git subprocesses."""
    def __init__(self):
        self.process = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(self, spec: str) -> bytes | None:
        assert self.process.stdin and self.process.stdout
        self.process.stdin.write((spec + '\n').encode())
        self.process.stdin.flush()
        header = self.process.stdout.readline().decode().strip()
        if header.endswith(' missing'):
            return None
        _, kind, size = header.split()
        if kind != 'blob':
            raise ValueError(f'Expected blob for {spec}, got {kind}')
        content = self.process.stdout.read(int(size))
        self.process.stdout.read(1)  # trailing newline emitted by --batch
        return content

    def close(self) -> None:
        if self.process.stdin:
            self.process.stdin.close()
        self.process.wait()


def semantic(raw: bytes | None):
    if raw is None:
        return None
    return json.loads(raw.decode('utf-8-sig'), parse_float=Decimal)


def without_split_labels(value):
    if not isinstance(value, dict):
        return value
    # JSON round trip is safe here: this comparison object is never persisted.
    clone = json.loads(json.dumps(value, default=str))
    try:
        for item in clone['tickerInfo']['events']['splits']:
            item.pop('type', None)
    except (KeyError, TypeError):
        pass
    return clone


def changed_paths(base: str, upstream: str) -> list[tuple[str, str]]:
    output = git('diff', '--name-status', '-z', base, upstream, '--',
                 'public/data', 'public/calendar', 'public/exchange-rates.json',
                 'public/missing-logos.json', 'public/nav.json')
    parts = output.split('\0')
    records = []
    index = 0
    while index < len(parts) - 1:
        status = parts[index]
        if not status:
            break
        index += 1
        # No renames appeared in the snapshot, but retain the parser safety.
        if status[0] in {'R', 'C'}:
            index += 1
        path = parts[index]
        index += 1
        records.append((status[0], path))
    return records


def snapshot(entries: list[dict], archive: Path) -> None:
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        raise FileExistsError(f'Refusing to overwrite recovery archive: {archive}')
    manifest = {'createdAt': datetime.now(timezone.utc).isoformat(), 'entries': entries}
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for entry in entries:
            bundle.writestr(entry['path'], entry['raw'])
        public_entries = [{k: v for k, v in entry.items() if k != 'raw'} for entry in entries]
        bundle.writestr('manifest.json', json.dumps({**manifest, 'entries': public_entries}, ensure_ascii=False))
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError('Recovery archive CRC validation failed')
        for entry in entries:
            if sha(bundle.read(entry['path'])) != entry['sha256']:
                raise RuntimeError('Recovery archive hash validation failed: ' + entry['path'])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='HEAD')
    parser.add_argument('--upstream', default='origin/main')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--report', type=Path, default=ROOT / 'var/data-management/upstream-reconcile.json')
    args = parser.parse_args()
    actions, conflicts, recovery = [], [], []
    blobs = BlobReader()
    for status, path in changed_paths(args.base, args.upstream):
        local_path = ROOT / path
        local = local_path.read_bytes() if local_path.exists() else None
        base = blobs.read(f'{args.base}:{path}')
        upstream = blobs.read(f'{args.upstream}:{path}')
        # A dry run is read-only; retaining ~1 GB of source buffers would make
        # its conflict check needlessly slow.  Only an applying run needs the
        # pre-write recovery payload.
        if args.apply and local is not None:
            recovery.append({'path': path, 'sha256': sha(local), 'raw': local})
        try:
            local_value, base_value = semantic(local), semantic(base)
        except (UnicodeError, json.JSONDecodeError) as exc:
            conflicts.append({'path': path, 'reason': f'local JSON cannot be compared: {exc}'})
            continue
        unchanged = local_value == base_value
        split_label_only = False
        if not unchanged and path.startswith('public/data/'):
            split_label_only = without_split_labels(local_value) == without_split_labels(base_value)
        if not (unchanged or split_label_only):
            conflicts.append({'path': path, 'reason': 'local semantic change overlaps upstream update'})
            continue
        if status == 'D' or upstream is None:
            actions.append({'path': path, 'action': 'delete', 'reason': 'upstream deletion'})
            continue
        output = upstream
        repaired = False
        if path.startswith('public/data/'):
            output, fixes = repair(output)
            repaired = bool(fixes)
            output = compact_bytes(output)
        actions.append({'path': path, 'action': 'replace', 'upstreamSha256': sha(upstream),
                        'outputSha256': sha(output), 'repairedSplitLabels': repaired})
        if args.apply:
            atomic_write(local_path, output)
    blobs.close()
    if conflicts:
        # A partial apply can hide a mixed state.  Require an explicit rerun after review.
        args.apply = False
    archive = None
    if args.apply:
        if not args.archive:
            raise ValueError('--archive is required with --apply')
        archive = args.archive.resolve()
        if archive.is_relative_to(ROOT):
            raise ValueError('Recovery archive must be outside repository')
        snapshot(recovery, archive)
        # Writes are intentionally after verified backup.
        write_blobs = BlobReader()
        for action in actions:
            local_path = ROOT / action['path']
            if action['action'] == 'delete':
                local_path.unlink(missing_ok=True)
            else:
                upstream = write_blobs.read(f"{args.upstream}:{action['path']}")
                output, _ = repair(upstream) if action['path'].startswith('public/data/') else (upstream, [])
                if action['path'].startswith('public/data/'):
                    output = compact_bytes(output)
                atomic_write(local_path, output)
        write_blobs.close()
    report = {'base': args.base, 'upstream': args.upstream, 'createdAt': datetime.now(timezone.utc).isoformat(),
              'applied': bool(args.apply), 'archive': str(archive) if archive else None,
              'actions': actions, 'conflicts': conflicts}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'applied': report['applied'], 'actions': len(actions), 'conflicts': len(conflicts),
                      'archive': report['archive']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
