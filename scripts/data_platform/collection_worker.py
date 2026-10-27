"""Bounded worker for explicit registered adapters; disabled unless enabled by caller.

The caller owns the platform writer lock/checkpoint lifecycle. Adapter persistence
must be idempotent: a crash after ingest but before finish is recoverable by replay.
No dynamic import, arbitrary URL, or credential is accepted from a queued job.
"""
from datetime import datetime, timedelta, timezone
from scripts.data_platform.collection_jobs import claim, finish


def run_next(store, source, adapter, *, enabled=False, now=None):
    if not enabled:
        return {'status': 'disabled', 'requests': 0}
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        raise ValueError('Timezone-aware worker clock required')
    job = claim(store,clock.isoformat(),source=source)
    if job is None:
        return {'status': 'idle', 'requests': 0}
    try:
        result = adapter(store, job)
        outcome = result.get('outcome', 'partial')
        if outcome not in {'complete','no_dividends','partial'}:
            raise ValueError('Invalid adapter outcome')
        if outcome != 'partial':
            # Entire requested window, not first/last row bounds, must be certified.
            if result.get('verifiedWindow') != [job['start'],job['end']]:
                raise ValueError('Adapter did not verify requested history window')
        finish(store,job['id'],owner=job['owner'],outcome=outcome,evidence=result.get('evidence'))
        return {'status':outcome,'jobId':job['id'],'attempts':job['attempts']}
    except Exception:
        # Do not persist exception strings: HTTP errors may contain credential URLs.
        retry = clock+timedelta(minutes=min(1440,2**min(job['attempts'],10)))
        finish(store,job['id'],owner=job['owner'],outcome='retry',retry_at=retry.isoformat(),error='adapter_failed')
        return {'status':'retry','jobId':job['id'],'retryAt':retry.isoformat()}
