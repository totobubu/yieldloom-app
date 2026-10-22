"""Plan private backup retention; applying requires the exact reviewed plan and writer lease."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.checkpoints import R2Objects, PREFIX, current, validate_manifest
from scripts.data_platform.pipeline import digest, encode, private_path
from scripts.data_platform.remote_lock import remote_writer, LOCK_KEY

HASH = r'[a-f0-9]{64}'
MANIFEST = re.compile(rf'{PREFIX}/manifests/({HASH})\.json')
OBJECT = re.compile(rf'{PREFIX}/objects/({HASH})')


def instant(value):
    clock = datetime.fromisoformat(value)
    if clock.tzinfo is None:
        raise ValueError('Retention timestamps must include timezone')
    return clock.astimezone(timezone.utc)


def plan(remote, now=None, retain_days=30, minimum=7, grace_days=7, pins=()):
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None or retain_days < 7 or minimum < 2 or grace_days < 1:
        raise ValueError('Retention requires timezone, >=7 days, >=2 snapshots and >=1 grace day')
    if any(not re.fullmatch(HASH, sha) for sha in pins):
        raise ValueError('Invalid pinned manifest hash')
    pointer, etag = current(remote)
    if not pointer:
        raise ValueError('No current checkpoint; cleanup cannot establish protected references')
    inventory = [row for row in remote.inventory(PREFIX + '/', limit=100000) if row['key'] != LOCK_KEY]
    rows = {}
    for row in inventory:
        if row['key'] in rows or not row.get('etag') or not isinstance(row.get('bytes'), int) or row['bytes'] < 0:
            raise ValueError('Invalid or duplicate inventory metadata')
        instant(row['modifiedAt'])
        rows[row['key']] = row
    manifests = {}
    ignored = []
    for key, row in rows.items():
        match = MANIFEST.fullmatch(key)
        if not match:
            if not OBJECT.fullmatch(key):
                ignored.append(key)
            continue
        body, actual = remote.get(key)
        if actual != row['etag'] or digest(body) != match[1] or len(body) != row['bytes']:
            raise ValueError('Manifest changed or failed integrity validation')
        manifest = json.loads(body)
        validate_manifest(manifest)
        created = manifest.get('createdAt')
        created = instant(created) if created else None
        manifests[match[1]] = {'key': key, 'row': row, 'manifest': manifest, 'created': created}
    required = set(pins) | {pointer['manifestSha256']}
    if not required <= manifests.keys():
        raise ValueError('Current or pinned checkpoint absent from complete inventory')
    ordered = sorted(manifests, key=lambda sha: manifests[sha]['created'] or datetime.max.replace(tzinfo=timezone.utc), reverse=True)
    cutoff = clock - timedelta(days=grace_days)
    keep = required | set(ordered[:minimum]) | {sha for sha, value in manifests.items()
        if instant(value['row']['modifiedAt']) >= cutoff} | {sha for sha, value in manifests.items()
        if value['created'] is None or value['created'] >= clock - timedelta(days=retain_days)}
    referenced = {}
    for sha in keep:
        for entry in manifests[sha]['manifest']['files']:
            key = f"{PREFIX}/objects/{entry['sha256']}"
            if key not in rows or rows[key]['bytes'] != entry['bytes']:
                raise ValueError('Retained checkpoint references missing or wrong-size object')
            referenced[key] = entry['bytes']
    delete_manifests = [value['row'] for sha, value in manifests.items()
                        if sha not in keep and instant(value['row']['modifiedAt']) < cutoff]
    delete_objects = [row for key, row in rows.items()
                      if OBJECT.fullmatch(key) and key not in referenced and instant(row['modifiedAt']) < cutoff]
    candidates = sorted(delete_manifests, key=lambda r: r['key']) + sorted(delete_objects, key=lambda r: r['key'])
    return {'schemaVersion': 1, 'kind': 'private_retention_plan', 'createdAt': clock.isoformat(),
            'pointerEtag': etag, 'currentManifest': pointer['manifestSha256'],
            'policy': {'retainDays': retain_days, 'minimumSnapshots': minimum, 'graceDays': grace_days, 'pins': sorted(pins)},
            'retainedManifests': sorted(keep), 'protectedObjects': len(referenced),
            'inventoryDigest': digest(encode(sorted(inventory, key=lambda r: r['key'])).encode()),
            'candidates': candidates, 'deleteBytes': sum(r['bytes'] for r in candidates), 'ignoredKeys': sorted(ignored)}


def apply(remote, reviewed, expected_digest, now=None):
    if digest(encode(reviewed).encode()) != expected_digest:
        raise ValueError('Reviewed plan digest mismatch')
    clock = now or datetime.now(timezone.utc)
    created = instant(reviewed['createdAt'])
    if not timedelta(0) <= clock - created <= timedelta(hours=24):
        raise ValueError('Retention plan is expired or from the future')
    with remote_writer(remote, 'retention'):
        policy = reviewed['policy']
        rebuilt = plan(remote, created, policy['retainDays'], policy['minimumSnapshots'], policy['graceDays'], policy['pins'])
        # The mutable lease is excluded from the reviewed inventory digest below.
        if rebuilt != reviewed:
            raise ValueError('Remote state changed; create and review a new retention plan')
        if reviewed['candidates']:
            from scripts.data_platform.operations import verify_conditions
            verify_conditions(remote)
        for row in reviewed['candidates']:
            remote.delete(row['key'], expected=row['etag'])
    return {'deletedObjects': len(reviewed['candidates']), 'deletedBytes': reviewed['deleteBytes']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--apply-plan', type=Path)
    parser.add_argument('--plan-sha256')
    parser.add_argument('--retain-days', type=int, default=30)
    parser.add_argument('--minimum', type=int, default=7)
    parser.add_argument('--grace-days', type=int, default=7)
    parser.add_argument('--pin', action='append', default=[])
    args = parser.parse_args()
    if args.apply_plan:
        if not args.plan_sha256:
            parser.error('Apply requires the exact reviewed --plan-sha256')
        reviewed = json.loads(private_path(args.apply_plan).read_text())
        print(encode(apply(R2Objects(), reviewed, args.plan_sha256)))
    else:
        if not args.output:
            parser.error('Plan requires --output in a private directory')
        result = plan(R2Objects(), retain_days=args.retain_days, minimum=args.minimum, grace_days=args.grace_days, pins=args.pin)
        target = private_path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        target.write_text(encode(result) + '\n')
        print(encode({'planSha256': digest(encode(result).encode()), 'candidates': len(result['candidates']),
                      'deleteBytes': result['deleteBytes'], 'mode': 'dry_run'}))


if __name__ == '__main__':
    main()
