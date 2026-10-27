"""Explicit OpenDART single-company financial adapter, disabled by default.

Financial-statement dividends paid are not per-share dividend events. This adapter
never writes the dividend ledger or the public catalog.
"""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import os
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from scripts.data_platform.parsers import fact

ENDPOINT='https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json'
REPORTS={'11011','11012','11013','11014'}


def request_spec(corp_code, year, report, basis):
    if not re.fullmatch(r'\d{8}',corp_code) or not 1999 <= int(year) <= 2100 or report not in REPORTS or basis not in {'CFS','OFS'}:
        raise ValueError('Explicit corporation, year, report and CFS/OFS required')
    return {'corp_code':corp_code,'bsns_year':str(year),'reprt_code':report,'fs_div':basis}


def fetch_financials(parameters, api_key):
    try:
        request=Request(ENDPOINT+'?'+urlencode({**parameters,'crtfc_key':api_key}),headers={'Accept':'application/json'})
        with urlopen(request,timeout=25) as response:
            return response.read(16*1024*1024+1)
    except Exception:
        raise RuntimeError('OpenDART request failed') from None


def parse_financials(body, parameters):
    if len(body)>16*1024*1024:
        raise ValueError('OpenDART response too large')
    payload=json.loads(body)
    if payload.get('status')=='013':
        return None  # No report returned is not zero financial values or no dividends.
    if payload.get('status')!='000' or not payload.get('list'):
        raise ValueError('OpenDART unsuccessful or empty response')
    rows,seen=[],set()
    for row in payload['list']:
        if any(str(row.get(key)) != parameters[key] for key in ('corp_code','bsns_year','reprt_code')):
            raise ValueError('OpenDART report identity mismatch')
        if row.get('fs_div',parameters['fs_div']) != parameters['fs_div']:
            raise ValueError('OpenDART statement basis mismatch')
        if not row.get('account_id') or not row.get('sj_div') or not re.fullmatch(r'[A-Z]{3}',row.get('currency','')):
            raise ValueError('OpenDART account identity or currency missing')
        for period in ('thstrm','frmtrm','bfefrmtrm'):
            value=row.get(period+'_amount')
            if value is None or str(value).strip() in {'','-'}:
                continue
            text=str(value).replace(',','').strip()
            try: number=Decimal(text)
            except InvalidOperation: raise ValueError('Invalid OpenDART amount') from None
            if not number.is_finite(): raise ValueError('Nonfinite OpenDART amount')
            key=(row['sj_div'],row['account_id'],row.get('account_detail'),period)
            if key in seen: raise ValueError('Duplicate OpenDART account/period')
            seen.add(key)
            rows.append(fact('financials','corporation:dart:'+parameters['corp_code'],row['account_id'],text,
                unit='currency',currency=row['currency'],statementBasis=parameters['fs_div'],
                businessYear=parameters['bsns_year'],reportCode=parameters['reprt_code'],
                statement=row['sj_div'],accountDetail=row.get('account_detail'),accountName=row.get('account_nm'),
                period=period,periodLabel=row.get(period+'_nm'),reportedPeriod=row.get(period+'_dt'),
                receiptNumber=row.get('rcept_no')))
    if not rows: raise ValueError('No reported financial amounts')
    return rows


def collect_financials(store, corp_code, year, report, basis, *, enabled=False, transport=fetch_financials, api_key=None, now=None):
    if not enabled: return {'status':'disabled','httpRequests':0}
    parameters=request_spec(corp_code,year,report,basis)
    key=api_key or os.environ.get('OPENDART_API_KEY')
    if not key: raise ValueError('OpenDART credential not configured')
    body=transport(parameters,key)
    if key.encode() in body:
        raise ValueError('Credential appeared in response; archival rejected')
    rows=parse_financials(body,parameters)
    timestamp=(now or datetime.now(timezone.utc)).isoformat()
    source={'id':f'dart-{corp_code}-{year}-{report}-{basis.lower()}',
            'url':ENDPOINT+'?'+urlencode(parameters),'parserVersion':'1'}
    _,sha=store.document(source['url'],{'status':200,'body':body},timestamp)
    if rows is None:
        with store.db:
            store.set_state(source['id'],{**store.state(source['id']),'lastCheckedAt':timestamp,'availability':'report_not_returned'})
        return {'status':'no_data','httpRequests':1,'observations':0}
    result=store.accept(source,rows,sha,timestamp,'opendart-financials-v1')
    return {'status':'collected','httpRequests':1,**result,'public':False}
