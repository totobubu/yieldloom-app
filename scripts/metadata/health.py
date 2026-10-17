"""Collection observations; successful records are preserved across failed runs."""
from __future__ import annotations


def update_health(previous, observations, observed_at):
    result = {'schemaVersion': 1, 'providers': dict(previous.get('providers', {}))}
    for provider, observation in observations.items():
        old = result['providers'].get(provider, {})
        verified = observation.get('verifiedLinks', 0)
        errors = observation.get('errors', [])
        catalog_failed = observation.get('catalogFailed', False)
        baseline = old.get('lastHealthyLinkCount', 0)
        dropped = baseline >= 5 and verified < baseline * 0.7
        healthy = verified > 0 and not errors and not catalog_failed and not dropped
        result['providers'][provider] = {
            'lastAttemptAt': observed_at,
            'lastSuccessAt': observed_at if verified > 0 and not catalog_failed else old.get('lastSuccessAt'),
            'lastCompleteAt': observed_at if healthy else old.get('lastCompleteAt'),
            'lastHealthyLinkCount': verified if healthy else baseline,
            'verifiedLinks': verified, 'products': observation.get('products', 0),
            'failureCount': len(errors), 'coverageDrop': dropped,
            'consecutiveFailedRuns': 0 if verified > 0 and not catalog_failed else old.get('consecutiveFailedRuns', 0) + 1,
            'status': 'failed' if catalog_failed or verified == 0 else 'degraded' if errors or dropped else 'healthy',
        }
    return result
