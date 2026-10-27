"""Reuse official adapters for scoped backfills and existing core release gates.

Produces private candidates only. Conflicting revisions and missing baseline events
block review readiness; no public pointer or approved ledger is written here.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
from scripts.data_platform.parsers import fact
from scripts.data_platform.pipeline import encode, private_path
from scripts.data_v2.build_release import normalize
from scripts.data_v2.validate_snapshot import validate_event
from scripts.data_v2.check_cutover import compare

ROOT=Path(__file__).resolve().parents[2]


def official_adapter(catalog, *, providers=None, index=None, now=None):
    if providers is None:
        from scripts.content_pipeline.providers import PROVIDERS
        providers=PROVIDERS
    from scripts.content_pipeline.providers.base import SourceCandidate
    if index is None:
        index=json.loads((ROOT/'public/content-studio/distribution-index.json').read_text())['tickers']
    targets={row['ticker']:row for row in index}
    instruments={f"instrument:isin:{r.get('isin')}:{r.get('market')}":r for r in catalog if r.get('active',True)}
    clock=now or datetime.now(timezone.utc)
    adapters,documents={},{}
    def collect(store,job):
        instrument=instruments.get(job['entity'])
        target=targets.get(instrument['symbol']) if instrument else None
        if not target or job['dataset']!='dividends': raise ValueError('Official route not registered')
        slug=target['providerSlug']
        if slug not in providers: raise ValueError('Official adapter not registered')
        adapter=adapters.setdefault(slug,providers[slug]())
        candidates=[]
        if hasattr(adapter,'issuer_candidate'):
            try: candidates.append(adapter.issuer_candidate(instrument['symbol']))
            except ValueError: pass
        url=target['latest'].get('official_url')
        if url and url not in {c.url for c in candidates}:
            candidates.append(SourceCandidate(url=url,metadata={'ticker':instrument['symbol']}))
        successful=False; evidence=None
        for candidate in candidates[:2]:
            try:
                adapter.validate_url(candidate.url)
                cache_key=(slug,candidate.url)
                if cache_key not in documents: documents[cache_key]=adapter.fetch(candidate)
                document=documents[cache_key]
                _,evidence=store.document(document.source_url,{'status':200,'body':document.content},clock.isoformat())
                events=adapter.parse(document)
                rows=[]
                for event in events:
                    if event.ticker!=instrument['symbol'] or not job['start']<=event.ex_date<=job['end']: continue
                    if event.currency!=instrument['currency']: raise ValueError('Official currency mismatch')
                    value={'provider':slug,'ticker':event.ticker,'amount':event.distribution_per_share,
                           'currency':event.currency,'declaredDate':event.declared_date,'exDate':event.ex_date,
                           'recordDate':event.record_date,'payableDate':event.payable_date,'frequency':event.frequency,
                           'verificationStatus':event.verification_status,'officialUrl':event.official_url,
                           'collectionMethod':'official_fetch'}
                    rows.append(fact('dividends',job['entity'],'distribution',value,as_of=event.ex_date,
                                     unit='record',currency=event.currency,provider=slug))
                if rows:
                    store.accept({'id':'official-'+slug,'url':document.source_url,'parserVersion':adapter.parser_version},
                                 rows,evidence,clock.isoformat(),'official-backfill-v1')
                    successful=True
                    break
                successful=True
            except Exception:
                continue
        if not successful: raise RuntimeError('Official routes failed')
        return {'outcome':'partial','evidence':evidence}
    return collect


def candidate_review(store, baseline, output=None):
    groups={}
    for row in store.db.execute('SELECT identity_key,payload FROM observations ORDER BY id'):
        record=json.loads(row['payload'])
        if record.get('dataset')=='dividends' and record.get('field')=='distribution':
            groups.setdefault(row['identity_key'],[]).append(record)
    candidates=[]; conflicts=[]; rejected=[]
    for key,versions in groups.items():
        if len({encode(v['value']) for v in versions})>1:
            conflicts.append(key);continue
        record=versions[-1]
        event={**record['value'],'sourceSha256':record['sourceDocumentId']}
        store.raw(record['sourceDocumentId'])
        try:
            errors=validate_event(normalize(event),key)
            if errors: raise ValueError('Invalid event')
        except (ValueError,KeyError,TypeError):
            rejected.append(key);continue
        candidates.append(event)
    result=compare(baseline,candidates)
    result.update({'conflicts':conflicts,'rejected':rejected,'candidateCount':len(candidates),
                   'ready':result['ready'] and not conflicts and not rejected,'published':False})
    if output is not None:
        path=private_path(output)
        if path.exists(): raise ValueError('Review output must be a new directory')
        path.mkdir(parents=True,mode=0o700)
        (path/'candidates.json').write_text(encode(candidates)+'\n')
        (path/'review.json').write_text(encode(result)+'\n')
    return result
