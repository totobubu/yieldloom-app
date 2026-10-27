"""Atomically stage a bounded private core candidate with owned long-price models.

No remote client, public pointer or activation option exists here. Passing schema
validation is separate from coverage and adjustment-basis approval.
"""
from datetime import datetime,timezone
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from scripts.data_platform.collection_scope import TARGETS
from scripts.data_platform.identity_enrichment import effective_catalog
from scripts.data_platform.official_backfill import candidate_review
from scripts.data_platform.owned_price_model import build_model,validate_model
from scripts.data_platform.pipeline import encode,digest,private_path

ROOT=Path(__file__).resolve().parents[2]


def validate_core(root):
    result=subprocess.run([sys.executable,str(ROOT/'scripts/data_v2/validate_snapshot.py'),
        '--data-dir',str(root)],capture_output=True,text=True,timeout=30)
    if result.returncode: raise ValueError('Core candidate validation failed')
    manifest=json.loads((root/'manifest.json').read_text())
    instruments=json.loads((root/'catalog/search-index.json').read_text())['instruments']
    for symbol,relative in manifest.get('priceModels',{}).items():
        if symbol not in TARGETS or relative!='market-prices/'+symbol+'.json': raise ValueError('Invalid price model path')
        matches=[row for row in instruments if row['symbol']==symbol]
        if len(matches)!=1: raise ValueError('Price model absent from catalog')
        validate_model(json.loads((root/relative).read_text()),matches[0])


def build_candidate(store,catalog,baseline,symbols,output,release_id,*,now=None):
    targets=set(symbols)
    if not targets or not targets<=TARGETS or len(symbols)!=len(targets): raise ValueError('Outside fixed candidate scope')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}',release_id): raise ValueError('Invalid candidate release ID')
    output=private_path(output)
    if output.exists(): raise ValueError('Candidate output must be new')
    catalog=effective_catalog(store,catalog)
    selected=[row for row in catalog if row['symbol'] in targets and row.get('active',True)]
    if len(selected)!=len(targets) or {r['symbol'] for r in selected}!=targets: raise ValueError('Unresolved target identity')
    if any(not all(row.get(k) for k in ('isin','market','currency','ipoDate')) for row in selected): raise ValueError('Incomplete target identity')
    entities={f"instrument:isin:{r['isin']}:{r['market']}" for r in selected}
    clock=now or datetime.now(timezone.utc)
    scoped_baseline=[row for row in baseline if row['ticker'] in targets]
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage=Path(temporary)/'candidate';stage.mkdir(mode=0o700)
        review=candidate_review(store,scoped_baseline,stage/'dividend-review',entities=entities)
        blockers=[];models={};sources=set()
        for row in store.db.execute('SELECT payload FROM observations'):
            observation=json.loads(row['payload'])
            if observation.get('entityId') in entities:
                sha=observation['sourceDocumentId'];store.raw(sha);sources.add(sha)
        for instrument in selected:
            symbol=instrument['symbol']
            try: model=build_model(store,instrument)
            except ValueError:
                blockers.append({'symbol':symbol,'reason':'price_model_unavailable_or_invalid'});continue
            models[symbol]=model
            if model['coverage'].get('conflictingDates'): blockers.append({'symbol':symbol,'reason':'price_conflicts'})
            if model['coverage'].get('excludedIncompleteCandles'): blockers.append({'symbol':symbol,'reason':'incomplete_ohlc'})
            if model.get('adjustmentBasis')!='split_adjusted_verified': blockers.append({'symbol':symbol,'reason':'adjustment_basis_unverified'})
            for dataset in ('market-prices','dividends'):
                if not model.get('collectionCoverage',{}).get(dataset,{}).get('complete'):
                    blockers.append({'symbol':symbol,'dataset':dataset,'reason':'inception_coverage_unverified'})
        if not review['ready']: blockers.append({'reason':'dividend_review_blocked'})
        catalog_path=stage/'catalog-input.json';catalog_path.write_text(encode({'instruments':selected})+'\n')
        core=stage/'core'
        result=subprocess.run([sys.executable,str(ROOT/'scripts/data_v2/build_release.py'),
            '--input',str(stage/'dividend-review/candidates.json'),'--catalog-input',str(catalog_path),
            '--release-id',release_id,'--output',str(core)],capture_output=True,text=True,timeout=30)
        if result.returncode: raise ValueError('Core candidate construction failed')
        manifest=json.loads((core/'manifest.json').read_text())
        for symbol,model in sorted(models.items()):
            relative='market-prices/'+symbol+'.json';path=core/relative
            path.parent.mkdir(exist_ok=True)
            body=(encode(model)+'\n').encode();path.write_bytes(body)
            manifest['files'].append({'path':relative,'sha256':digest(body)})
        manifest.update({'candidateOnly':True,'scope':sorted(targets),'priceModels':{s:'market-prices/'+s+'.json' for s in models}})
        (core/'manifest.json').write_text(encode(manifest)+'\n')
        validate_core(core)
        report={'schemaVersion':1,'releaseId':release_id,'asOf':clock.isoformat(),'symbols':sorted(targets),
                'snapshotValid':True,'candidateBuilt':True,'priceModelCount':len(models),
                'dividendReview':review,'sourceDocuments':sorted(sources),'blockers':blockers,
                'readyForPublication':False,'published':False,'replacementAllowed':False,
                'reason':'targeted_private_candidate_requires_full_release_review',
                'coreManifestSha256':digest((core/'manifest.json').read_bytes())}
        (stage/'review.json').write_text(encode(report)+'\n')
        stage.rename(output)
    return report
