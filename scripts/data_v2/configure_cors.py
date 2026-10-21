"""Preserve bucket CORS rules and add the Yieldloom production read origin."""
import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.cloud.r2_helper import get_r2_client

ORIGIN = 'https://yieldloom-app.vercel.app'


def allow_production_origin(existing: list[dict]) -> list[dict]:
    rules = copy.deepcopy(existing)
    for rule in rules:
        if 'GET' in rule.get('AllowedMethods', []) and any(
            origin in rule.get('AllowedOrigins', []) for origin in (ORIGIN, '*')
        ):
            return rules
    for rule in rules:
        methods = set(rule.get('AllowedMethods', []))
        if 'GET' in methods and methods <= {'GET', 'HEAD'}:
            rule.setdefault('AllowedOrigins', []).append(ORIGIN)
            return rules
    rules.append({'AllowedOrigins': [ORIGIN], 'AllowedMethods': ['GET', 'HEAD'],
                  'AllowedHeaders': ['Accept', 'Cache-Control'], 'ExposeHeaders': ['ETag']})
    return rules


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply the additive change (default: dry run)')
    args = parser.parse_args()
    client, bucket = get_r2_client()
    if not client or not bucket:
        raise RuntimeError('R2 credentials are required')
    try:
        existing = client.get_bucket_cors(Bucket=bucket).get('CORSRules', [])
    except Exception as error:
        if getattr(error, 'response', {}).get('Error', {}).get('Code') != 'NoSuchCORSConfiguration':
            raise
        existing = []
    updated = allow_production_origin(existing)
    changed = existing != updated
    if args.apply and changed:
        client.put_bucket_cors(Bucket=bucket, CORSConfiguration={'CORSRules': updated})
    print('::notice title=Core production CORS::' + json.dumps({
        'origin': ORIGIN, 'changed': changed, 'applied': args.apply, 'rules': updated,
    }))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
