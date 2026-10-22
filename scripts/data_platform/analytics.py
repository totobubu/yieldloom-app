"""Private exposure estimates from issuer-reported weights and versioned inputs."""
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import argparse
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.data_platform.pipeline import Store, encode, private_path, load_registry
from scripts.data_platform.quality import observations, evaluate
from scripts.data_platform.locking import writer_lock
from scripts.data_platform.releases import write_json


def project(rows, input_versions):
    groups = defaultdict(list)
    for row in rows:
        if row['dataset'] == 'holdings' and row['field'] == 'position':
            groups[(row['entityId'], row['asOfDate'], row['sourceId'])].append(row)
    result = []
    for (entity, day, source), positions in sorted(groups.items()):
        totals = {key: defaultdict(Decimal) for key in ('Sector', 'Location', 'Market Currency')}
        weighted, total = 0, Decimal(0)
        for row in positions:
            value = row['value']
            raw = value.get('Weight (%)')
            if raw is None:
                continue
            weight = Decimal(raw)
            if not weight.is_finite():
                raise ValueError('Nonfinite source weight')
            weighted += 1
            total += weight
            for key in totals:
                label = value.get(key)
                totals[key][label if label and label != '-' else 'unclassified'] += weight
        result.append({'schemaVersion': 1, 'dataset': 'exposures', 'entityId': entity, 'asOfDate': day,
            'verificationStatus': 'derived_estimate', 'methodVersion': 'issuer-reported-weights-v1',
            'basis': 'Rounded issuer position weights; not economic risk or hedge-adjusted exposure',
            'inputVersions': {source: input_versions[source]},
            'coverage': {'positions': len(positions), 'weightedPositions': weighted,
                         'unweightedPositions': len(positions) - weighted, 'reportedWeightTotal': str(total)},
            'groups': {key: [{'label': label, 'reportedWeightPercent': str(weight)}
                       for label, weight in sorted(values.items())] for key, values in totals.items()}})
    return result


def build(store, registry, output):
    output = private_path(output)
    if output.exists():
        raise ValueError('Analytics candidate already exists')
    rows, versions = [], {}
    for source in registry['sources']:
        if not source.get('enabled') or 'holdings' not in source['datasets']:
            continue
        state = store.state(source['id'])
        versions[source['id']] = {key: state.get(key) for key in ('fingerprint', 'parserVersion', 'sourceDocumentId')}
        rows.extend(observations(store, source['id']))
    snapshots = project(rows, versions)
    if not snapshots:
        raise ValueError('No holdings observations')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / 'candidate'
        stage.mkdir()
        files = [write_json(stage, f'exposures-{index}.json', value) for index, value in enumerate(snapshots)]
        manifest = {'schemaVersion': 1, 'kind': 'private_derived_candidate',
                    'methodVersion': 'issuer-reported-weights-v1', 'files': files,
                    'inputQuality': [r for r in evaluate(store, registry)['sources'] if r['sourceId'] in versions],
                    'inputVersions': versions, 'createdAt': datetime.now(timezone.utc).isoformat()}
        write_json(stage, 'manifest.json', manifest)
        stage.rename(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT / 'var/data-platform')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with writer_lock(private_path(args.root)):
        store = Store(args.root)
        try:
            result = build(store, load_registry(), args.output)
        finally:
            store.close()
    print(encode({'kind': result['kind'], 'files': len(result['files'])}))


if __name__ == '__main__':
    main()
