"""Single US-stock observations. Never writes the authoritative distribution ledger."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlparse
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from .database import ContentDatabase
from .models import utc_now_iso

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / 'data-v2/issuer-sources.json'
DATE_TEXT = r'[A-Z][a-z]+\s+\d{1,2},\s+\d{4}'


class StockCollectionError(ValueError):
    def __init__(self, code, retryable=False):
        super().__init__(code)
        self.code, self.retryable = code, retryable


def fetch_source(url):
    # Node's supported proxy transport also works in the managed development environment.
    major = int(subprocess.check_output(['node', '--version'], text=True).lstrip('v').split('.')[0])
    command = ['node']
    if major >= 24 and (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')):
        command.append('--use-env-proxy')
    command.append(str(Path(__file__).with_name('fetch_stock_source.mjs')))
    try:
        result = subprocess.run(command, input=json.dumps({'url': url}), text=True,
                                capture_output=True, timeout=45, check=True)
        payload = json.loads(result.stdout)
    except (subprocess.SubprocessError, ValueError) as error:
        raise StockCollectionError('fetch_failed', True) from error
    if payload.get('error'):
        raise StockCollectionError(payload['error'], payload.get('status') in {429, 500, 502, 503, 504})
    return base64.b64decode(payload['content'], validate=True)


def _date(value):
    return datetime.strptime(re.sub(r'\s+', ' ', value), '%B %d, %Y').date().isoformat()


def validate_issuer_url(url, issuer):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in issuer['allowedHosts'] or parsed.username or parsed.password:
        raise StockCollectionError('unsupported_source')


def discover_bac(content, issuer):
    soup = BeautifulSoup(content, 'html.parser')
    links = set()
    for link in soup.select('a[href]'):
        href = link['href']
        if 'preferred' in href.lower() or not re.search(r'(stock-dividend|common-stock-dividend)', href):
            continue
        url = urljoin(issuer['articleOrigin'], href)
        validate_issuer_url(url, issuer)
        if '/content/newsroom/press-releases/' in url:
            links.add(url)
    if not links:
        raise StockCollectionError('official_index_empty', True)
    return sorted(links, reverse=True)[:24]


def parse_bac(content, url, issuer):
    validate_issuer_url(url, issuer)
    soup = BeautifulSoup(content, 'html.parser')
    paragraphs = [re.sub(r'\s+', ' ', ' '.join(p.stripped_strings)).strip() for p in soup.find_all('p')]
    dates = {m.group(1) for p in paragraphs if (m := re.fullmatch(r'\s*(' + DATE_TEXT + r')\s+at\s+.+', p))}
    if len(dates) != 1:
        raise StockCollectionError('ambiguous_declared_date')
    declared = _date(next(iter(dates)))
    facts = []
    for paragraph in paragraphs:
        if not re.search(r'Bank of America (?:Corporation.*?announced.*?common stock|common stock)', paragraph, re.I):
            continue
        # Only the common-stock sentence; preferred securities are separate instruments.
        common = re.search(r'common stock\b(.+?)(?=The Board|preferred stock|$)', paragraph, re.I)
        text = common.group(1) if common else ''
        amount = re.search(r'\$(\d+(?:\.\d+)?)\s+per share', text, re.I)
        payable = re.search(r'payable\s+(?:on\s+)?(' + DATE_TEXT + ')', text)
        record = re.search(r'(?:record as of|record on|record of)\s+(' + DATE_TEXT + ')', text)
        if not amount or not payable or not record:
            continue
        raw = amount.group(1)
        if Decimal(raw) <= 0:
            raise StockCollectionError('invalid_amount')
        ex = re.search(r'(?:ex-dividend date (?:of|is)|ex-dividend on)\s+(' + DATE_TEXT + ')', text, re.I)
        fact = {'ticker': 'BAC', 'amountRaw': raw, 'currency': issuer['currency'],
                'declaredDate': declared, 'recordDate': _date(record.group(1)),
                'payableDate': _date(payable.group(1)), 'exDate': _date(ex.group(1)) if ex else None,
                'sourceUrl': url, 'sourceClass': 'issuer_official',
                'verificationStatus': 'partial_evidence' if not ex else 'needs_review',
                'missingFields': [] if ex else ['exDate']}
        if not (fact['declaredDate'] <= fact['recordDate'] <= fact['payableDate']):
            raise StockCollectionError('invalid_official_dates')
        if fact not in facts:
            facts.append(fact)
    if len(facts) != 1:
        raise StockCollectionError('common_stock_announcement_not_found')
    return facts


ISSUER_ADAPTERS = {'bank-of-america-newsroom': (discover_bac, parse_bac)}


def _decimal(value, positive=False):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise StockCollectionError('invalid_market_value') from exc
    if not number.is_finite() or (positive and number <= 0):
        raise StockCollectionError('invalid_market_value')
    return format(number, 'f')


def parse_market(content, symbol, expected_currency, today):
    payload = json.loads(content, parse_float=Decimal)
    result = (payload.get('chart', {}).get('result') or [None])[0]
    if not result:
        raise StockCollectionError('market_no_data', True)
    meta = result.get('meta', {})
    expected_symbol = re.sub(r'\.([AB])$', r'-\1', symbol)
    if str(meta.get('symbol', '')).upper() != expected_symbol or meta.get('currency') != expected_currency:
        raise StockCollectionError('market_identity_mismatch')
    zone = ZoneInfo(meta.get('exchangeTimezoneName') or 'America/New_York')
    quote = (result.get('indicators', {}).get('quote') or [{}])[0]
    candles = []
    for index, stamp in enumerate(result.get('timestamp', [])):
        day = datetime.fromtimestamp(stamp, timezone.utc).astimezone(zone).date().isoformat()
        if day > today.isoformat():
            continue
        values = {key: (quote.get(key) or [])[index] if index < len(quote.get(key) or []) else None
                  for key in ('open', 'high', 'low', 'close', 'volume')}
        if values['close'] is None:
            continue
        close = _decimal(values['close'], True)
        row = {'date': day, 'close': close}
        for key, value in values.items():
            if value is not None:
                row[key] = _decimal(value, key != 'volume')
                if key == 'volume' and Decimal(row[key]) < 0:
                    raise StockCollectionError('invalid_market_value')
        if all(k in row for k in ('high', 'low', 'open')) and not (
                Decimal(row['low']) <= min(Decimal(row['open']), Decimal(close)) <=
                max(Decimal(row['open']), Decimal(close)) <= Decimal(row['high'])):
            raise StockCollectionError('invalid_ohlc')
        candles.append(row)
    history = []
    for event in result.get('events', {}).get('dividends', {}).values():
        ex = datetime.fromtimestamp(event['date'], timezone.utc).astimezone(zone).date().isoformat()
        if ex > today.isoformat():
            continue
        history.append({'ticker': symbol, 'ex_date': ex, 'distribution_per_share': _decimal(event['amount'], True),
                        'currency': expected_currency, 'declared_date': None, 'record_date': None,
                        'payable_date': None, 'verification_status': 'needs_review',
                        'source_class': 'public_aggregator', 'source_provider': 'yahoo',
                        'amount_basis': 'provider_adjusted_unknown'})
    splits = [{'date': datetime.fromtimestamp(e['date'], timezone.utc).astimezone(zone).date().isoformat(),
               'numerator': _decimal(e['numerator'], True), 'denominator': _decimal(e['denominator'], True)}
              for e in result.get('events', {}).get('splits', {}).values()
              if datetime.fromtimestamp(e['date'], timezone.utc).astimezone(zone).date() <= today]
    if not candles:
        raise StockCollectionError('market_no_data', True)
    return {'candles': sorted(candles, key=lambda row: row['date']),
            'history': sorted(history, key=lambda row: row['ex_date']), 'splits': splits,
            'currency': expected_currency, 'priceBasis': 'provider_adjusted_unknown'}


def _archive(database, raw_dir, symbol, url, content, source_class):
    digest = hashlib.sha256(content).hexdigest()
    path = raw_dir / 'stocks' / symbol / digest
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(content)
    with database.connect() as connection:
        connection.execute('''INSERT INTO stock_source_documents
            (ticker,source_url,source_class,content_sha256,local_path,observed_at) VALUES (?,?,?,?,?,?)
            ON CONFLICT(ticker,source_url,content_sha256) DO UPDATE SET observed_at=excluded.observed_at''',
            (symbol, url, source_class, digest, str(path), utc_now_iso()))
        row = connection.execute('SELECT id FROM stock_source_documents WHERE ticker=? AND source_url=? AND content_sha256=?',
                                 (symbol, url, digest)).fetchone()
    return row['id']


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temp.replace(path)


def collect_stock(symbol, database, raw_dir, output, request_id=None, *, fetcher=fetch_source, today=None, registry=None):
    today = today or date.today()
    catalog = json.loads((ROOT / 'data-v2/catalog-seed.json').read_text())['instruments']
    instrument = next((row for row in catalog if row['symbol'] == symbol), None)
    if not instrument or not is_us_stock(instrument):
        raise StockCollectionError('unsupported_instrument')
    registry = registry if registry is not None else json.loads(REGISTRY.read_text())['issuers']
    issuer = registry.get(symbol)
    file_name = f'stock-evidence-{symbol.lower()}.json'
    path = output / file_name
    previous = json.loads(path.read_text()) if path.exists() else {}
    run = database.start_pipeline_run()
    steps, announcements, errors = [], list(previous.get('announcements', [])), []
    official_count = 0
    official_started = utc_now_iso()
    if issuer:
        try:
            discover, parse = ISSUER_ADAPTERS[issuer['adapter']]
            index = fetcher(issuer['indexUrl'])
            _archive(database, raw_dir, symbol, issuer['indexUrl'], index, 'issuer_official')
            candidates = discover(index, issuer)
            for url in candidates:
                try:
                    document = fetcher(url)
                    source_id = _archive(database, raw_dir, symbol, url, document, 'issuer_official')
                    facts = parse(document, url, issuer)
                    for fact in facts:
                        if fact['declaredDate'] > today.isoformat():
                            continue
                        fact['contentSha256'] = hashlib.sha256(document).hexdigest()
                        event_key = '|'.join([symbol, fact['declaredDate'], 'common'])
                        encoded = json.dumps(fact, sort_keys=True, ensure_ascii=False)
                        comparable = {key: value for key, value in fact.items() if key != 'contentSha256'}
                        fact_hash = hashlib.sha256(json.dumps(comparable, sort_keys=True).encode()).hexdigest()
                        with database.connect() as connection:
                            connection.execute('''INSERT OR IGNORE INTO stock_issuer_announcements
                                (ticker,event_key,fact_hash,source_document_id,declared_date,ex_date,payload_json)
                                VALUES (?,?,?,?,?,?,?)''', (symbol, event_key, fact_hash, source_id,
                                fact['declaredDate'], fact['exDate'], encoded))
                        # Keep corrections as separate evidence instead of replacing prior amounts.
                        equivalent = lambda row: {key: value for key, value in row.items() if key not in {'contentSha256', 'verificationStatus'}}
                        if not any(equivalent(row) == equivalent(fact) for row in announcements):
                            corrections = [row for row in announcements if row['declaredDate'] == fact['declaredDate']]
                            if corrections:
                                for row in corrections:
                                    row['verificationStatus'] = 'conflicting'
                                fact['verificationStatus'] = 'conflicting'
                                errors.append({'code': 'official_revision_needs_review', 'sourceUrl': url})
                            announcements.append(fact)
                        official_count += 1
                except Exception as exc:
                    errors.append({'code': getattr(exc, 'code', 'official_parse_failed'), 'sourceUrl': url})
            steps.append({'name': '기업 공식 공시 수집', 'state': 'partial' if official_count else 'failure',
                          'detail': '공식 공시의 확인된 항목만 저장하며 배당락일을 추정하지 않습니다.',
                          'code': 'missing_ex_date' if official_count and any(a['exDate'] is None for a in announcements) else 'official_evidence' if official_count else (errors[0]['code'] if errors else 'no_official_data'),
                          'count': official_count, 'startedAt': official_started, 'completedAt': utc_now_iso()})
        except Exception as exc:
            errors.append({'code': getattr(exc, 'code', 'official_fetch_failed')})
            steps.append({'name': '기업 공식 공시 수집', 'state': 'failure', 'code': errors[-1]['code'], 'startedAt': official_started, 'completedAt': utc_now_iso()})
    else:
        steps.append({'name': '기업 공식 공시 수집', 'state': 'unsupported', 'code': 'issuer_not_registered', 'detail': '기업 공식 출처가 아직 등록되지 않았습니다.'})
    market_started = utc_now_iso()
    market = {key: previous.get(key, []) for key in ('candles', 'history', 'splits')}
    market_ok = False
    start = date(today.year - 5, today.month, min(today.day, 28))
    if previous.get('candles'):
        start = date.fromisoformat(previous['candles'][-1]['date']) - timedelta(days=120)
    stamp = lambda day: int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())
    yahoo_symbol = re.sub(r'\.([AB])$', r'-\1', symbol)
    query = urlencode({'period1': stamp(start), 'period2': stamp(today + timedelta(days=1)), 'interval': '1d', 'events': 'div,splits'})
    market_url = f'https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}?{query}'
    try:
        document = fetcher(market_url)
        current = parse_market(document, symbol, instrument['currency'], today)
        for row in current['history']:
            row['source_url'] = market_url
        source_id = _archive(database, raw_dir, symbol, market_url, document, 'public_aggregator')
        with database.connect() as connection:
            connection.execute('INSERT OR IGNORE INTO stock_market_snapshots (ticker,source_document_id,payload_json) VALUES (?,?,?)',
                               (symbol, source_id, json.dumps(current)))
        market = current
        for field, key in [('candles', 'date'), ('history', 'ex_date'), ('splits', 'date')]:
            merged = {row[key]: row for row in previous.get(field, [])}
            for row in current[field]:
                if field == 'history' and row[key] in merged and merged[row[key]]['distribution_per_share'] != row['distribution_per_share']:
                    errors.append({'code': 'dividend_revision_needs_review'})
                    merged[row[key]] = {**merged[row[key]], 'verification_status': 'needs_review', 'conflicting': True}
                else:
                    merged[row[key]] = row
            market[field] = sorted(merged.values(), key=lambda row: row[key])
        market_ok = True
        steps.append({'name': '참고 시세·배당 수집', 'state': 'success', 'count': len(current['history']), 'startedAt': market_started, 'completedAt': utc_now_iso()})
    except Exception as exc:
        errors.append({'code': getattr(exc, 'code', 'market_fetch_failed')})
        steps.append({'name': '참고 시세·배당 수집', 'state': 'failure', 'code': errors[-1]['code'], 'startedAt': market_started, 'completedAt': utc_now_iso()})
    status = 'partial' if market_ok or official_count else 'failed'
    message = ('기업 공시와 참고 자료를 수집했습니다. 배당락일 미확인·참고 배당은 공식 확정 이력과 구분합니다.'
               if official_count and market_ok else
               '참고 시세·배당을 갱신했습니다. 기업 공식 출처는 아직 연결되지 않았거나 조회에 실패했습니다.'
               if market_ok else
               '공식 공시의 확인된 항목을 저장했습니다. 참고 시세·배당 갱신에 실패해 이전 자료를 보존했습니다.'
               if official_count else '최신 자료를 수집하지 못했습니다. 이전 자료를 보존했습니다.')
    result = {'status': status, 'requestId': request_id, 'symbol': symbol, 'steps': steps,
              'message': message,
              'errors': errors, 'officialAnnouncements': official_count,
              'marketUpdated': market_ok, 'observedAt': utc_now_iso()}
    payload = {'schemaVersion': 1, 'symbol': symbol, 'currency': instrument['currency'],
               'requestId': request_id, 'announcements': sorted(announcements, key=lambda a: a['declaredDate'], reverse=True),
               **market, 'sourceUrl': market_url if market_ok else previous.get('sourceUrl'),
               'marketObservedAt': result['observedAt'] if market_ok else previous.get('marketObservedAt'), 'result': result}
    _write(path, payload)
    index_path = output / 'stock-evidence-index.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {'schemaVersion': 1, 'tickers': []}
    rows = {row['ticker']: row for row in index['tickers']}
    rows[symbol] = {'ticker': symbol, 'historyUrl': f'/content-studio/{file_name}',
                    'latest': market['history'][-1] if market['history'] else None, 'updatedAt': result['observedAt'], 'requestId': request_id}
    index['tickers'] = sorted(rows.values(), key=lambda row: row['ticker'])
    _write(index_path, index)
    for step in steps:
        database.add_pipeline_step(run, step['name'], 'failed' if step['state'] == 'failure' else 'warning',
                                   message=step.get('code', ''), details=step)
    database.finish_pipeline_run(run, 'failed' if status == 'failed' else 'warning', result)
    return result


def is_us_stock(row):
    stock = row.get('securityType') == 'stock' or (row.get('securityType') != 'etf' and not row.get('officialProvider') and not re.search(r'\bETF\b', f"{row.get('koName') or ''} {row.get('longName') or ''}", re.I))
    retired = json.loads((ROOT / 'data-v2/security-status.json').read_text())['securities']
    delisted = any(item['symbol'].replace('.', '-') == row['symbol'].replace('.', '-') and item.get('status') == 'delisted' for item in retired)
    return stock and not delisted and row.get('active', True) and row.get('currency') == 'USD' and row.get('market') in {'NYSE', 'NASDAQ', 'NYSEAMERICAN', 'AMEX', 'BATS'}


def validate_stock_export(output):
    index = json.loads((output / 'stock-evidence-index.json').read_text())
    if index.get('schemaVersion') != 1 or not isinstance(index.get('tickers'), list):
        raise StockCollectionError('invalid_stock_index')
    seen = set()
    for row in index['tickers']:
        symbol = row.get('ticker', '')
        expected = f'/content-studio/stock-evidence-{symbol.lower()}.json'
        if not re.fullmatch(r'[A-Z0-9][A-Z0-9.-]{0,11}', symbol) or symbol in seen or row.get('historyUrl') != expected:
            raise StockCollectionError('invalid_stock_index')
        seen.add(symbol)
        value = json.loads((output / expected.rsplit('/', 1)[-1]).read_text())
        if value.get('schemaVersion') != 1 or value.get('symbol') != symbol or value.get('currency') != 'USD':
            raise StockCollectionError('invalid_stock_snapshot')
        if value.get('result', {}).get('status') not in {'partial', 'failed'}:
            raise StockCollectionError('invalid_stock_result')
        for field in ('candles', 'history', 'announcements'):
            if not isinstance(value.get(field), list):
                raise StockCollectionError('invalid_stock_snapshot')
        for event in value['history']:
            date.fromisoformat(event['ex_date'])
            _decimal(event['distribution_per_share'], True)
            if event.get('ticker') != symbol or event.get('verification_status') != 'needs_review' or event.get('source_class') != 'public_aggregator':
                raise StockCollectionError('reference_promotion_forbidden')
        for candle in value['candles']:
            date.fromisoformat(candle['date'])
            _decimal(candle['close'], True)
        for event in value['announcements']:
            if event.get('ticker') != symbol or event.get('sourceClass') != 'issuer_official':
                raise StockCollectionError('invalid_issuer_evidence')
            date.fromisoformat(event['declaredDate'])
            _decimal(event['amountRaw'], True)
            for field in ('exDate', 'recordDate', 'payableDate'):
                if event.get(field) is not None:
                    date.fromisoformat(event[field])
    return len(seen)
