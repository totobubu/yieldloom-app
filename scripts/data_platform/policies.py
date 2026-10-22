"""Free-source policy gates for both display and redistributed projections."""
import hashlib
import json


def source_fingerprint(source, registry):
    value = {'source': source, 'policy': registry.get('policies', {}).get(source.get('policyId'))}
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def public_policy(source, registry, datasets):
    policy = registry.get('policies', {}).get(source.get('policyId'), {})
    if (source.get('publicDisplay') != 'approved' or policy.get('status') != 'approved'
            or policy.get('free') is not True or policy.get('publicDisplay') is not True
            or policy.get('redistribution') is not True or not set(datasets) <= set(policy.get('datasets', []))
            or not policy.get('version') or not policy.get('citation') or not policy.get('evidenceUrl')):
        raise ValueError('Public use not approved: ' + source['id'])
    return policy
