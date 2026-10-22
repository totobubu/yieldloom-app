"""Pure parsers: original units and dates survive normalization."""
from __future__ import annotations

import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
import io
import hashlib
import json
import re
import xml.etree.ElementTree as ET


def decimal(value: str) -> str:
    text = value.strip().replace(',', '').replace('$', '').replace('%', '')
    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f'Invalid decimal: {value}') from error
    if not parsed.is_finite():
        raise ValueError('Nonfinite financial value')
    return text


def date(value: str) -> str:
    for pattern in ('%b %d, %Y', '%B %d, %Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(value.strip(), pattern).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f'Invalid source date: {value}')


def fact(dataset, entity, field, value, as_of=None, unit='text', currency=None, **qualifiers):
    return {'dataset': dataset, 'entityId': entity, 'field': field, 'value': value,
            'asOfDate': as_of, 'unit': unit, 'currency': currency,
            'qualifiers': qualifiers, 'verificationStatus': 'source_observed',
            'dateStatus': 'source_dated' if as_of else 'as_of_unknown'}


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)


def nasdaq(content: bytes, config: dict) -> list[dict]:
    text = content.decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(text), delimiter='|')
    symbol_key = 'Symbol' if 'Symbol' in (reader.fieldnames or []) else 'ACT Symbol'
    if not {symbol_key, 'Security Name', 'Test Issue', 'ETF'} <= set(reader.fieldnames or []):
        raise ValueError('Unexpected Nasdaq directory headers')
    rows, trailer = [], False
    for row in reader:
        symbol = row[symbol_key]
        if symbol.startswith('File Creation Time:'):
            trailer = True
            continue
        if not symbol or row['Test Issue'] != 'N':
            continue
        rows.append(fact('identity', f"listing-candidate:{config['id']}:{symbol}",
                         'listing', {key: val for key, val in row.items() if key and val is not None},
                         unit='record', identityStatus='candidate',
                         sourceDirectory=config['id']))
    if not trailer or not rows:
        raise ValueError('Incomplete or empty Nasdaq directory')
    return rows


def holdings(content: bytes, config: dict) -> list[dict]:
    rows = list(csv.reader(io.StringIO(content.decode('utf-8-sig'))))
    if not rows or rows[0] != [config['fundName']]:
        raise ValueError('Holdings fund identity mismatch')
    metadata = {r[0]: r[1] for r in rows if len(r) == 2}
    as_of = date(metadata['Fund Holdings as of'])
    start = next((i for i, r in enumerate(rows) if r[:2] == ['Ticker', 'Name']), None)
    required = {'Ticker', 'Name', 'Asset Class', 'Weight (%)', 'Quantity', 'Market Value',
                'Notional Value', 'Market Currency'}
    if start is None or not required <= set(rows[start]):
        raise ValueError('Holdings schema changed')
    result, seen = [], set()
    for values in rows[start + 1:]:
        if len(values) > 1 and len(values) != len(rows[start]):
            raise ValueError('Malformed holdings row')
        if len(values) != len(rows[start]) or not values[0]:
            continue
        row = dict(zip(rows[start], values))
        for key in ('Weight (%)', 'Quantity', 'Market Value', 'Notional Value', 'Price', 'FX Rate'):
            if key in row:
                row[key] = None if row[key] in ('-', '') else decimal(row[key])
        key = json.dumps([row.get(k) for k in ('Ticker', 'Name', 'Asset Class', 'Market Currency', 'Exchange')])
        if key in seen:
            raise ValueError('Holdings identifier is ambiguous')
        seen.add(key)
        result.append(fact('holdings', config['entityId'], 'position', row, as_of,
                           unit='position', rowKey=hashlib.sha256(key.encode()).hexdigest(), coverage='issuer_file',
                           identifierStatus='source_identifier_unresolved'))
    if not result:
        raise ValueError('No holdings rows')
    if metadata.get('Shares Outstanding'):
        result.append(fact('fund-observations', config['entityId'], 'sharesOutstanding',
                           decimal(metadata['Shares Outstanding']), as_of, unit='shares',
                           scope='holdings_file'))
    return result


def fund_page(content: bytes, config: dict) -> list[dict]:
    parser = VisibleText()
    parser.feed(content.decode('utf-8'))
    text = re.sub(r'\s+', ' ', ' '.join(parser.parts))
    if config['fundName'] not in text or not re.search(r'\b' + re.escape(config['symbol']) + r'\b', text):
        raise ValueError('Fund page identity mismatch')
    day = r'([A-Z][a-z]+ \d{1,2}, \d{4})'
    amount = r'([-+]?\d[\d,]*(?:\.\d+)?)'
    specs = [
        ('nav', rf'NAV as of {day}\s+(?:\$\s*)+{amount}', 'currency_per_share', True),
        ('aum', rf'Net Assets of Fund\s+\$?\s*{amount}\s+as of {day}', 'currency', False),
        ('sharesOutstanding', rf'Shares Outstanding\s+{amount}\s+as of {day}', 'shares', False),
        ('closingPrice', rf'Closing Price\s+\$?\s*{amount}\s+as of {day}', 'currency_per_share', False),
        ('medianSpread30D', rf'30 Day Median Bid/Ask Spread\s+{amount}%\s+as of {day}', 'percent', False),
        ('secYield30D', rf'30 Day SEC Yield as of {day}\s+{amount}%', 'percent', True),
        ('trailingYield12M', rf'12m Trailing Yield as of {day}\s+{amount}%', 'percent', True),
    ]
    result = []
    for field, pattern, unit, date_first in specs:
        match = re.search(pattern, text)
        if match:
            raw, day_text = (match[2], match[1]) if date_first else (match[1], match[2])
            result.append(fact('fund-observations', config['entityId'], field, decimal(raw),
                               date(day_text), unit, config['currency'] if unit.startswith('currency') else None))
    fees = re.search(r'Expense Ratio:\s+Fees as stated in the prospectus\s+' + amount + '%', text)
    if fees:
        result.append(fact('fund-profile', config['entityId'], 'prospectusExpenseRatio',
                           decimal(fees[1]), unit='percent', scope='prospectus_reported',
                           feeScope='gross_or_net_not_resolved'))
    if not any(r['field'] == 'nav' for r in result) or not any(r['field'] == 'aum' for r in result):
        raise ValueError('Required dated NAV/AUM not found; refusing partial schema drift')
    return result


def fx(content: bytes, config: dict) -> list[dict]:
    root = ET.fromstring(content)
    day_nodes = [node for node in root.iter() if 'time' in node.attrib]
    if len(day_nodes) != 1:
        raise ValueError('Expected one ECB reference date')
    as_of = date(day_nodes[0].attrib['time'])
    result = []
    for node in day_nodes[0]:
        currency, rate = node.attrib.get('currency'), node.attrib.get('rate')
        if not currency or not re.fullmatch('[A-Z]{3}', currency) or rate is None:
            raise ValueError('Invalid ECB rate row')
        raw = decimal(rate)
        if Decimal(raw) <= 0:
            raise ValueError('Reference FX must be positive')
        result.append(fact('fx', f'fx:EUR/{currency}', 'referenceRate', raw, as_of,
                           'quote_currency_per_base_currency', currency,
                           baseCurrency='EUR', rateBasis='central_bank_reference'))
    if not result:
        raise ValueError('Empty ECB rates')
    return result


def filings(content: bytes, config: dict) -> list[dict]:
    data = json.loads(content)
    if str(data['cik']).zfill(10) != config['cik']:
        raise ValueError('SEC issuer identity mismatch')
    recent = data['filings']['recent']
    keys = ('accessionNumber', 'form', 'filingDate', 'reportDate', 'acceptanceDateTime', 'primaryDocument')
    if len({len(recent[k]) for k in keys}) != 1:
        raise ValueError('SEC filing columns have different lengths')
    result = []
    for index in range(min(config.get('maxFilings', 40), len(recent['form']))):
        row = {key: recent[key][index] for key in keys}
        result.append(fact('filings', f"issuer:cik:{config['cik']}", 'filing', row,
                           date(row['filingDate']), 'record', rowKey=row['accessionNumber'],
                           publishedAt=row['acceptanceDateTime'] or None,
                           periodEnd=row['reportDate'] or None))
    if not result:
        raise ValueError('Empty SEC filings')
    return result


PARSERS = {'nasdaq-directory': nasdaq, 'ishares-holdings': holdings,
           'ishares-profile': fund_page, 'ecb-fx': fx, 'sec-submissions': filings}
