"""Index unlimited legacy history in the official ledger without duplicating bars."""
import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.content_pipeline.database import ContentDatabase
from scripts.data_pipeline.compact_history import sha


def register(data_dir, db_path):
    database = ContentDatabase(db_path)
    database.initialize()
    count = actions = regimes = rows_count = 0
    with database.connect() as connection:
        for path in sorted(Path(data_dir).rglob('*.json')):
            raw = path.read_bytes()
            payload = json.loads(raw)
            info = payload.get('tickerInfo', {})
            if not info:
                continue
            rows = payload.get('backtestData', [])
            source_path = path.resolve().relative_to(ROOT).as_posix() if path.resolve().is_relative_to(ROOT) else path.resolve().as_posix()
            key = 'legacy:' + source_path
            digest = sha(raw)
            prices = [r['date'] for r in rows if r.get('close') is not None and r.get('date')]
            dividends = [r['date'] for r in rows if (r.get('amount') is not None or r.get('amountFixed') is not None)
                         and r.get('date') and not r.get('forecasted') and not r.get('expected')]
            connection.execute('''INSERT INTO history_sources
                (listing_key,symbol,isin,currency,source_path,content_sha256,row_count,
                 first_price_date,last_price_date,first_dividend_date,last_dividend_date,registered_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(listing_key) DO UPDATE SET
                symbol=excluded.symbol, isin=excluded.isin, currency=excluded.currency,
                content_sha256=excluded.content_sha256, row_count=excluded.row_count,
                first_price_date=excluded.first_price_date,last_price_date=excluded.last_price_date,
                first_dividend_date=excluded.first_dividend_date,last_dividend_date=excluded.last_dividend_date,
                registered_at=excluded.registered_at''',
                (key, info.get('Symbol') or info.get('symbol') or path.stem.upper(), info.get('isin'), info.get('currency'),
                 source_path,digest,len(rows),min(prices,default=None),max(prices,default=None),
                 min(dividends,default=None),max(dividends,default=None),datetime.now(timezone.utc).isoformat()))
            for event in info.get('events', {}).get('splits', []):
                try:
                    new, old = (Decimal(p) for p in event['ratio'].split(':'))
                    if not new.is_finite() or not old.is_finite() or min(new,old) <= 0 or new == old:
                        continue
                    connection.execute('''INSERT OR IGNORE INTO corporate_action_observations
                        (listing_key,effective_date,raw_ratio,new_shares,old_shares,action_type,source_sha256)
                        VALUES(?,?,?,?,?,?,?)''', (key,event['date'],event['ratio'],str(new),str(old),
                        'reverse-split' if new < old else 'split',digest))
                    actions += 1
                except (ValueError, KeyError, ArithmeticError):
                    continue
            for event in info.get('events', {}).get('frequencyChanges', []):
                if event.get('date') and event.get('to'):
                    connection.execute('''INSERT OR IGNORE INTO frequency_regime_observations
                        (listing_key,effective_date,previous_frequency,next_frequency,source_sha256)
                        VALUES(?,?,?,?,?)''', (key,event['date'],event.get('from'),event['to'],digest))
                    regimes += 1
            count += 1
            rows_count += len(rows)
    return dict(listings=count, historyRows=rows_count, corporateActions=actions, frequencyChanges=regimes)


if __name__ == '__main__':
    print(json.dumps(register(ROOT / 'public/data', ROOT / 'var/content-studio/distribution-events.sqlite')))
