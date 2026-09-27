"""Retention is unlimited; re-fetch windows never trim existing history."""
from datetime import date, timedelta
from contextlib import closing
from decimal import Decimal
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]


def dividend_refresh_start(last_date, inception=None, *, today=None, full=False):
    today = today or date.today()
    if full or not last_date:
        return inception or '1900-01-01'
    # Include prior known date, but don't let a future forecast skip collection.
    anchor = min(date.fromisoformat(last_date), today)
    return (anchor - timedelta(days=120)).isoformat()


def merge_yahoo_dividend(row, amount, symbol, *, observation_db=None):
    """New events can be added; revised historic values require review.

    Yahoo may rebase past dividends after a split. A different observed number
    alone is not evidence that our original payment was wrong.
    """
    if row.get('amount') is not None:
        if Decimal(str(row['amount'])) == Decimal(str(amount)):
            return False
        path = Path(observation_db or ROOT / 'var/content-studio/distribution-events.sqlite')
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS dividend_conflicts (
                symbol TEXT, ex_date TEXT, existing_amount TEXT, observed_amount TEXT,
                source TEXT, basis TEXT, original_row TEXT, status TEXT DEFAULT 'needs_review',
                observed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(symbol, ex_date, existing_amount, observed_amount, source))''')
            connection.execute('''INSERT OR IGNORE INTO dividend_conflicts
                (symbol, ex_date, existing_amount, observed_amount, source, basis, original_row)
                VALUES (?, ?, ?, ?, 'yahoo', 'provider_adjusted_unknown', ?)''',
                (symbol, row['date'], str(row['amount']), str(amount), json.dumps(row, ensure_ascii=False)))
        return False
    row['amount'] = amount
    row['amountSource'] = 'yahoo'
    row['amountBasis'] = 'provider_adjusted_unknown'
    row.pop('forecasted', None)
    return True
