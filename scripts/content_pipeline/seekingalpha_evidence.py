"""Read public Seeking Alpha dividend tables; never guess from snippets."""
import re
from datetime import datetime
from urllib.parse import urlparse
from scripts.content_pipeline.investing_evidence import Tables


def parse_date(value):
    for pattern in ("%b %d, %Y", "%B %d, %Y", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try: return datetime.strptime(value.strip(), pattern).date().isoformat()
        except ValueError: pass
    raise ValueError("Unsupported Seeking Alpha date")


def parse_seekingalpha(content, ticker, url, currency):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'seekingalpha.com' or parsed.path != f'/symbol/{ticker}/dividends/history':
        raise ValueError('Seeking Alpha security URL mismatch')
    if currency != 'USD': raise ValueError('Seeking Alpha adapter supports reviewed USD securities only')
    parser = Tables(); parser.feed(content.decode('utf-8'))
    text = ' '.join(parser.text)
    if not re.search(r'\b' + re.escape(ticker) + r'\b', text) or 'Dividend History' not in text:
        raise ValueError('Seeking Alpha security identity not found')
    aliases = {'ex-div date': 'ex_date', 'ex-dividend date': 'ex_date', 'amount': 'amount_raw',
               'cash amount': 'amount_raw', 'pay date': 'payable_date', 'payment date': 'payable_date',
               'payout date': 'payable_date', 'record date': 'record_date', 'declare date': 'declared_date', 'declaration date': 'declared_date'}
    for table in parser.tables:
        if not table: continue
        mapping = {index: aliases[label.lower().strip()] for index, label in enumerate(table[0]) if label.lower().strip() in aliases}
        if not {'ex_date', 'amount_raw'} <= set(mapping.values()): continue
        rows = []
        for cells in table[1:]:
            try:
                row = {field: cells[index].strip() for index, field in mapping.items()}
                row['amount_raw'] = row['amount_raw'].replace('$', '').replace(',', '')
                for field in ('ex_date', 'payable_date', 'record_date', 'declared_date'):
                    if field in row: row[field] = parse_date(row[field]) if row[field] not in {'', '-', '—'} else None
                if not row['ex_date']: continue
                rows.append({'ticker': ticker, 'currency': currency, 'raw': {'cells': cells}, **row})
            except (ValueError, IndexError): continue
        if rows: return rows
    raise ValueError('Public Seeking Alpha dividend table unavailable')
