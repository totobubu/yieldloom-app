"""Audit every catalog ETF; collect and register evidence-backed underlying links.

Fund titles/objectives, not portfolio holdings or navigation text, establish links.
A failed refresh never removes a previously verified relationship.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import threading
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from lxml import html

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.metadata.health import update_health
SOURCES = {
    'direxion': ('https://www.direxion.com/single-stock-etfs', r'/product/[^/?#]+/?$', ['Direxion']),
    'kurv': ('https://www.kurvinvest.com/etfs', r'/etf/([a-z0-9.-]+)/?$', ['Kurv']),
    'graniteshares': ('https://graniteshares.com/etfs/', r'/etfs/([a-z0-9.-]+)/?$', ['GraniteShares']),
    'roundhill': ('https://www.roundhillinvestments.com/etf/', r'/etf/([a-z0-9.-]+)/?$', ['Roundhill Investments']),
    'yieldmax': ('https://yieldmaxetfs.com/our-etfs/', r'/our-etfs/([a-z0-9.-]+)/?$', ['YieldMax']),
    'defiance': ('https://www.defianceetfs.com/wp-json/defiance/v1/etfs-explore', r'/([a-z0-9.-]{2,6})/?$', ['Defiance']),
    'rex': ('https://www.rexshares.com/', r'/([a-z0-9.-]{2,6})/?$', ['REX', 'Rex', 'T-Rex']),
    'proshares': ('https://www.proshares.com/our-etfs', r'/our-etfs/(?:leveraged-and-inverse|strategic)/([a-z0-9.-]+)/?$', ['ProShares', 'Proshares', 'ProSares']),
}
# Identity aliases, never fund-symbol prefix guesses. Titles still need official evidence.
ALIASES = {
    'Apple': 'AAPL', 'Amazon': 'AMZN', 'Alphabet': 'GOOGL', 'Google': 'GOOGL',
    'Microsoft': 'MSFT', 'Netflix': 'NFLX', 'Tesla': 'TSLA', 'NVIDIA': 'NVDA',
    'Advanced Micro Devices': 'AMD', 'Broadcom': 'AVGO', 'Meta': 'META',
    'Coinbase': 'COIN', 'MicroStrategy': 'MSTR', 'Strategy': 'MSTR',
    'Palantir': 'PLTR', 'Uber': 'UBER', 'Robinhood': 'HOOD', 'Costco': 'COST',
    'Berkshire Hathaway': 'BRK.B', 'BRKB': 'BRK.B', 'Alibaba': 'BABA', 'Baidu': 'BIDU',
    'Airbnb': 'ABNB', 'Arm Holdings': 'ARM', 'ASML': 'ASML', 'Adobe': 'ADBE',
    'PayPal': 'PYPL', 'Salesforce': 'CRM', 'Carvana': 'CVNA', 'CrowdStrike': 'CRWD',
    'Snowflake': 'SNOW', 'Super Micro Computer': 'SMCI', 'Moderna': 'MRNA',
    'UnitedHealth': 'UNH', 'United Health': 'UNH', 'Eli Lilly': 'LLY',
    'Walmart': 'WMT', 'Exxon Mobil': 'XOM', 'ExxonMobil': 'XOM', 'JPMorgan Chase': 'JPM',
    'DraftKings': 'DKNG', 'Hims': 'HIMS', 'Circle': 'CRCL', 'CoreWeave': 'CRWV',
    'Rigetti': 'RGTI', 'D-Wave': 'QBTS', 'Riot Platforms': 'RIOT', 'Micron': 'MU',
    'Intel': 'INTC', 'Oracle': 'ORCL', 'Qualcomm': 'QCOM', 'Boeing': 'BA',
    'Rocket Lab': 'RKLB', 'AppLovin': 'APP', 'SoFi': 'SOFI', 'Marvell': 'MRVL',
    'AeroVironment': 'AVAV', 'Figma': 'FIG', 'Vistra': 'VST', 'Vertiv': 'VRT',
    'Spotify': 'SPOT', 'Palo Alto': 'PANW', 'IonQ': 'IONQ', 'Oklo': 'OKLO', 'Sandisk': 'SNDK',
    'Marathon Digital': 'MARA', 'Block': 'XYZ',
}
# Ordinary English words which also happen to be stock symbols cannot prove identity.
AMBIGUOUS = {'A', 'I', 'IT', 'ON', 'ALL', 'FOR', 'IN', 'OF', 'TO', 'BY', 'OR', 'BE', 'ARE', 'CAN', 'NEW', 'ONE', 'TWO', 'LONG', 'SHORT', 'ETF', 'ETFS', 'USD', 'NAV', 'US', 'UK', 'INC', 'LP', 'LLC', 'CORP', 'DAILY', 'WEEKLY', 'MONTHLY', 'STRATEGY', 'PREMIUM', 'INCOME', 'BULL', 'BEAR', 'GOLD', 'SILVER', 'BITCOIN', 'ETHEREUM', 'CASH', 'AI'}
# AI is a real C3.ai underlying only when the issuer explicitly labels it.
SYMBOL = re.compile(r'^[A-Z][A-Z0-9.-]{0,11}$')
FETCH_LOCKS = defaultdict(threading.Lock)
FETCHED = {}


def clean(value):
    return ' '.join(value.split())


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def validate_url(url, provider):
    expected = urlparse(SOURCES[provider][0]).hostname.removeprefix('www.')
    parsed = urlparse(url)
    if parsed.scheme != 'https' or (parsed.hostname or '').removeprefix('www.') != expected:
        raise ValueError(f'Non-official URL for {provider}: {url}')


def fetch(url, provider, cache, offline=False):
    # Bull/bear tickers can share a page; fetch once and avoid competing writes.
    with FETCH_LOCKS[url]:
        key = (url, str(cache), offline)
        if key not in FETCHED:
            FETCHED[key] = _fetch(url, provider, cache, offline)
        return FETCHED[key]


def _fetch(url, provider, cache, offline=False):
    validate_url(url, provider)
    key = hashlib.sha256(url.encode()).hexdigest()
    path = cache / (key + '.html')
    error_path = cache / (key + '.error.json')
    if not offline:
        request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; YieldloomMetadata/1.0)'})
        try:
            with urlopen(request, timeout=35) as response:
                validate_url(response.url, provider)
                raw = response.read(8_000_001)
                if len(raw) > 8_000_000:
                    raise ValueError('Official source exceeds size limit')
        except Exception as exc:
            write_json(error_path, {'url': url, 'error': str(exc)})
            raise
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        write_json(cache / (key + '.json'), {'url': url, 'fetchedAt': datetime.now(timezone.utc).isoformat()})
        error_path.unlink(missing_ok=True)
    else:
        if not path.exists() and error_path.exists():
            raise ValueError(json.loads(error_path.read_text())['error'])
        raw = path.read_bytes()
    meta = json.loads((cache / (key + '.json')).read_text())
    return (json.loads(raw) if provider == 'defiance' and '/wp-json/' in url else html.fromstring(raw, base_url=url)), {
        'url': url, 'contentSha256': hashlib.sha256(raw).hexdigest(),
        'fetchedAt': meta['fetchedAt'],
    }


def title_underlyings(title, ticker, symbols):
    # Reject multi-company/basket/sector products, even if one known stock is mentioned.
    if re.search(r'\b(?:portfolio|basket|magnificent|sector|semiconductor|innovation|titans|FANG|fund of funds|top\s*\d+)\b', title, re.I):
        return set()
    scrubbed = re.sub(r'Yield\s*Premium\s*Strategy|Option\s+Income\s+Strategy|Income\s+Strategy', '', title, flags=re.I)
    # The generic word "Strategy" must not identify MicroStrategy in an income title.
    found = {underlying for alias, underlying in ALIASES.items()
             if alias != 'Strategy' and re.search(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', scrubbed, re.I)}
    tokens = re.findall(r'(?<![A-Za-z0-9])[A-Z][A-Z0-9]*(?:[.-][A-Z])?(?![A-Za-z0-9])', scrubbed)
    found.update(token for token in tokens if len(token) > 1 and token in symbols and token not in AMBIGUOUS and token != ticker)
    if re.search(r'\bC3\.?ai\b|\(AI\)', title, re.I):
        found.add('AI')
    found.discard(ticker)
    return found


def exposure(title):
    strategy = 'income' if re.search(r'income|yield|weeklypay|covered.call|option', title, re.I) else 'leveraged' if re.search(r'\d(?:\.\d+)?\s*[xX]|ultra|bull|bear|inverse|short', title, re.I) else 'single-stock'
    match = re.search(r'(?<!\d)(\d+(?:\.\d+)?)\s*[xX]\b', title)
    leverage = float(match.group(1)) if match else None
    direction = 'inverse' if re.search(r'\b(?:short|bear|inverse)\b', title, re.I) else 'long'
    if leverage is not None and direction == 'inverse':
        leverage = -leverage
    return {'strategy': strategy, 'direction': direction, 'leverage': leverage}


def record(ticker, title, underlying, provider, evidence, method):
    return {'symbol': ticker, 'underlying': underlying, 'provider': provider,
            'providerName': SOURCES[provider][2][0],
            **exposure(title), 'verificationStatus': 'official',
            'evidence': {**evidence, 'method': method, 'text': title}}


def discover(doc, provider, registered):
    url, pattern, _ = SOURCES[provider]
    found = {}
    if provider == 'defiance' and isinstance(doc, list):
        for fund in doc:
            ticker = str(fund.get('ticker', '')).upper()
            if not SYMBOL.fullmatch(ticker):
                continue
            validate_url(fund['url'], provider)
            found[ticker] = {'url': fund['url'], 'labels': [str(fund.get('name', ''))]}
        return found
    for a in doc.xpath('//a[@href]'):
        absolute = urljoin(url, a.get('href')).split('#')[0].split('?')[0]
        try:
            validate_url(absolute, provider)
        except ValueError:
            continue
        match = re.search(pattern, urlparse(absolute).path, re.I)
        if not match:
            continue
        ticker = match.group(1).upper() if match.lastindex else None
        label = clean(a.text_content())
        if provider == 'direxion':
            ticker = label if SYMBOL.fullmatch(label) else None
        if not ticker or len(ticker) > 6 or not SYMBOL.fullmatch(ticker):
            continue
        # Generic short site paths are not products unless the catalog names the ticker.
        if provider in {'rex', 'defiance'} and ticker not in registered and not re.search(r'\b' + re.escape(ticker) + r'\b', label):
            continue
        item = found.setdefault(ticker, {'url': absolute, 'labels': []})
        if label and label not in item['labels']:
            item['labels'].append(label)
    return found


def parse_product(doc, ticker, provider, symbols, evidence, catalog_labels=()):
    titles = [clean(t) for t in doc.xpath('//h1//text() | //title/text() | //meta[@property="og:title"]/@content') if clean(t)]
    # h1 can be fragmented into spans. Read full headings as an additional scoped title.
    titles += [clean(n.text_content()) for n in doc.xpath('//h1 | //h2')]
    titles = list(dict.fromkeys(titles))
    brands = r'Kurv|Roundhill|GraniteShares|YieldMax|Direxion|REX|T-REX|Defiance|ProShares'
    titles = [next((part.strip() for part in title.split('|') if re.search(r'ETF|WeeklyPay', part, re.I)), title)
              for title in titles if len(title) < 220 and re.search(brands, title, re.I)]
    page_candidates = [(title, title_underlyings(title, ticker, symbols)) for title in titles
                       if re.search(r'ETF|WeeklyPay', title, re.I)]
    page_candidates = [(title, targets) for title, targets in page_candidates if len(targets) == 1]
    if not page_candidates:
        return None
    targets = {next(iter(targets)) for _, targets in page_candidates}
    if len(targets) != 1:
        raise ValueError(f'Conflicting official product titles for {ticker}')
    # Identity must be present on the page, rather than relying only on a URL slug.
    text = clean(' '.join(doc.itertext()))
    if not re.search(r'(?<![A-Z0-9])' + re.escape(ticker) + r'(?![A-Z0-9])', text):
        raise ValueError(f'Official product identity not found: {ticker}')
    underlying = next(iter(targets))
    catalog_targets = set().union(*(title_underlyings(label, ticker, symbols) for label in catalog_labels))
    if catalog_targets and catalog_targets != {underlying}:
        raise ValueError(f'Catalog and detail disagree for {ticker}')
    title = max((title for title, _ in page_candidates), key=len)
    return record(ticker, title, underlying, provider, evidence, 'official-product-title')


def parse_direxion(doc, symbols, evidence):
    result = {}
    # Each tbody is one bull/bear pair. Reading each full title avoids rowspan
    # propagation leaking a benchmark from a preceding unrelated product.
    for row in doc.xpath('//tr'):
        cells = row.xpath('./td')
        if len(cells) < 3:
            continue
        ticker = clean(cells[1].text_content())
        title = clean(cells[2].text_content())
        if not SYMBOL.fullmatch(ticker) or not title.startswith('Direxion Daily'):
            continue
        targets = title_underlyings(title, ticker, symbols)
        if len(targets) == 1:
            result[ticker] = record(ticker, title, next(iter(targets)), 'direxion', evidence, 'official-catalog-row')
    return result


def validate_record(row):
    if not isinstance(row, dict) or not SYMBOL.fullmatch(str(row.get('symbol', ''))) or not SYMBOL.fullmatch(str(row.get('underlying', ''))):
        raise ValueError('Invalid relationship symbols')
    if row['symbol'] == row['underlying'] or row.get('verificationStatus') != 'official':
        raise ValueError('Unverified or self-referencing relationship')
    provider = row.get('provider')
    if provider not in SOURCES:
        raise ValueError('Unsupported evidence provider')
    evidence = row.get('evidence', {})
    validate_url(evidence.get('url', ''), provider)
    if not re.fullmatch('[a-f0-9]{64}', evidence.get('contentSha256', '')) or not evidence.get('text'):
        raise ValueError('Missing source evidence')
    datetime.fromisoformat(evidence['fetchedAt'])
    if row.get('strategy') not in {'income', 'leveraged', 'single-stock'} or row.get('direction') not in {'long', 'inverse'}:
        raise ValueError('Invalid exposure metadata')
    return row


def merge_records(previous, collected, rows):
    registered = {r['symbol']: r for r in rows}
    result = {ticker: validate_record(row) for ticker, row in previous.items()}
    conflicts = []
    for ticker, row in sorted(collected.items()):
        validate_record(row)
        if ticker not in registered or registered[ticker].get('active') is False:
            continue  # Full instrument registration needs confirmed exchange/currency metadata.
        providers = SOURCES[row['provider']][2]
        known_provider = registered[ticker].get('officialProvider') or registered[ticker].get('company')
        if known_provider and known_provider not in providers:
            conflicts.append({'symbol': ticker, 'reason': 'provider-mismatch', 'candidate': row})
            continue
        existing = result.get(ticker)
        legacy = (registered[ticker].get('underlying') or '').upper()
        if (existing and existing['underlying'] != row['underlying']) or (legacy and legacy != row['underlying']):
            conflicts.append({'symbol': ticker, 'reason': 'underlying-changed', 'candidate': row})
            continue
        result[ticker] = row
    return dict(sorted(result.items())), conflicts


def audit(rows, registry, relationships, collected, conflicts, failures):
    legacy = defaultdict(set)
    for underlying, tickers in relationships.items():
        for ticker in tickers:
            legacy[ticker].add(underlying)
    symbols = {r['symbol'] for r in rows}
    is_etf = lambda r: bool(r.get('company') or r.get('officialProvider') or re.search(r'\bETF\b', (r.get('koName') or '') + ' ' + (r.get('longName') or ''), re.I))
    stocks = [r for r in rows if not is_etf(r)]
    generic_names = {'타겟', '나스닥', '다우', '다우존스', '인베스코', '골드만삭스', '블랙록', '이튼', 'S&P 글로벌'}
    aliases = [(re.compile(r'(?<![가-힣A-Za-z])' + re.escape(r['koName']) + r'(?![가-힣A-Za-z])'), r['symbol'])
               for r in stocks if len(r.get('koName') or '') >= 2 and r.get('koName') not in generic_names]
    supported = {name for _, _, names in SOURCES.values() for name in names}
    conflict_symbols = {c['symbol'] for c in conflicts}
    entries = []
    for row in sorted(rows, key=lambda r: r['symbol']):
        provider = row.get('officialProvider') or row.get('company')
        if not is_etf(row):
            continue
        ticker = row['symbol']
        old = {t.upper() for t in legacy.get(ticker, set())} | ({row['underlying'].upper()} if row.get('underlying') else set())
        title = row.get('koName') or row.get('longName') or ''
        candidates = sorted({symbol for pattern, symbol in aliases if pattern.search(title) and symbol != ticker})
        status = 'verified' if ticker in registry else 'legacy-unverified' if old else 'needs-review' if candidates else 'no-single-underlying-detected'
        if ticker in conflict_symbols or len(old) > 1 or (ticker in registry and old and old != {registry[ticker]['underlying']}):
            status = 'conflict'
        entries.append({'symbol': ticker, 'name': title, 'provider': provider, 'status': status,
                        'underlying': registry.get(ticker, {}).get('underlying'),
                        'legacyUnderlyings': sorted(old), 'nameCandidates': candidates,
                        'collectorSupported': provider in supported})
    return {'schemaVersion': 1, 'scope': 'All catalog entries with an issuer or ETF in the name; not all are single-stock ETFs',
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'summary': {'catalogInstruments': len(rows), 'etfsAudited': len(entries),
                        'newComparedWithLegacy': sum(ticker not in legacy for ticker in registry),
                        **dict(Counter(r['status'] for r in entries))},
            'sourceFailures': failures, 'conflicts': conflicts,
            'unregisteredOfficialProducts': [collected[ticker] for ticker in sorted(set(collected) - symbols)],
            'instruments': entries}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collect', action='store_true', help='Refresh official sources; otherwise audit saved registry only')
    parser.add_argument('--offline', action='store_true', help='Replay the source cache without network')
    parser.add_argument('--apply', action='store_true', help='Register verified additions/refreshes; never deletes existing links')
    parser.add_argument('--provider', action='append', choices=SOURCES)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--cache', type=Path, default=ROOT / 'var/data-management/underlying-sources')
    parser.add_argument('--registry', type=Path, default=ROOT / 'data-v2/security-underlyings.json')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/data-management/underlying-audit.json')
    parser.add_argument('--health', type=Path, default=ROOT / 'data-v2/collection-health.json')
    args = parser.parse_args(argv)
    if not 1 <= args.workers <= 4:
        parser.error('workers must be 1..4')
    nav = json.loads((ROOT / 'public/nav.json').read_text())['nav']
    seed = json.loads((ROOT / 'data-v2/catalog-seed.json').read_text())['instruments']
    merged = {r['symbol']: r for r in nav}
    for row in seed:
        merged[row['symbol']] = {**merged.get(row['symbol'], {}), **row}
    rows = list(merged.values())
    registered = set(merged)
    symbols = registered | set(ALIASES.values())
    relationships = json.loads((ROOT / 'public/thumbnail-catalog.json').read_text())['relationships']
    previous = json.loads(args.registry.read_text()) if args.registry.exists() else {'schemaVersion': 1, 'instruments': {}}
    if previous.get('schemaVersion') != 1:
        raise ValueError('Unsupported registry schema')
    collected, failures, observations = {}, [], {}
    if not args.collect and not args.offline and args.report.exists():
        prior_report = json.loads(args.report.read_text(encoding='utf-8'))
        # A local re-audit must not erase evidence about unregistered products
        # or failures observed by the most recent real collection.
        collected = {row['symbol']: row for row in prior_report.get('unregisteredOfficialProducts', [])}
        failures = prior_report.get('sourceFailures', [])
    if args.collect or args.offline:
        for provider in args.provider or SOURCES:
            url = SOURCES[provider][0]
            before = len(failures)
            catalog_ok = False
            products = {}
            try:
                doc, evidence = fetch(url, provider, args.cache, args.offline)
                products = discover(doc, provider, registered)
                if not products:
                    raise ValueError('Official catalog has no product links')
                catalog_ok = True
                # Audit registered products absent from today's lineup as well.
                # A guessed URL is a fetch candidate only, never registration evidence.
                if provider in {'kurv', 'graniteshares', 'roundhill', 'yieldmax', 'rex', 'defiance'}:
                    prefixes = {'kurv': 'https://www.kurvinvest.com/etf/',
                                'graniteshares': 'https://graniteshares.com/etfs/',
                                'roundhill': 'https://www.roundhillinvestments.com/etf/',
                                'yieldmax': 'https://yieldmaxetfs.com/our-etfs/',
                                'rex': 'https://www.rexshares.com/', 'defiance': 'https://www.defianceetfs.com/'}
                    for row in rows:
                        if (row.get('officialProvider') or row.get('company')) in SOURCES[provider][2]:
                            ticker = row['symbol']
                            products.setdefault(ticker, {'url': prefixes[provider] + ticker.lower() + '/', 'labels': []})
                if provider == 'direxion':
                    collected.update(parse_direxion(doc, symbols, evidence))
                def collect_product(item):
                    ticker, product = item
                    try:
                        if not args.offline:
                            time.sleep(0.3)
                        detail, source = fetch(product['url'], provider, args.cache, args.offline)
                        row = parse_product(detail, ticker, provider, symbols, source, product['labels'])
                        return ticker, row, None
                    except Exception as exc:
                        return ticker, None, {'provider': provider, 'symbol': ticker, 'url': product['url'], 'error': str(exc)}
                pending = [(ticker, product) for ticker, product in products.items() if ticker not in collected]
                with ThreadPoolExecutor(max_workers=args.workers) as pool:
                    for ticker, row, error in pool.map(collect_product, pending):
                        if row:
                            collected[ticker] = row
                        if error:
                            failures.append(error)
                print(f'{provider}: {len(products)} products, {sum(r["provider"] == provider for r in collected.values())} verified links', flush=True)
            except Exception as exc:
                failures.append({'provider': provider, 'url': url, 'error': str(exc)})
            observations[provider] = {'products': len(products), 'catalogFailed': not catalog_ok,
                                      'verifiedLinks': sum(row['provider'] == provider for row in collected.values()),
                                      'errors': failures[before:]}
    if args.collect and not args.offline:
        previous_health = json.loads(args.health.read_text()) if args.health.exists() else {}
        write_json(args.health, update_health(previous_health, observations, datetime.now(timezone.utc).isoformat()))
    registry, conflicts = merge_records(previous['instruments'], collected, rows)
    report = audit(rows, registry, relationships, collected, conflicts, failures)
    write_json(args.report, report)
    if args.apply:
        write_json(args.registry, {'schemaVersion': 1, 'instruments': registry})
    print(json.dumps(report['summary'], ensure_ascii=False), flush=True)
    # Partial runs still retain valid additions and the full failure report.
    return 2 if failures or conflicts else 0


if __name__ == '__main__':
    sys.exit(main())
