"""Durable, bounded collection jobs in the existing checkpointed state database.

Workers must hold the platform writer lock. No HTTP or publication is performed here.
A successful request is not evidence of complete historical coverage.
"""
from datetime import date, timedelta
from scripts.data_platform.pipeline import encode, digest


def initialize(store):
    store.db.executescript('''
        CREATE TABLE IF NOT EXISTS collection.jobs (
            id TEXT PRIMARY KEY, entity TEXT NOT NULL, dataset TEXT NOT NULL,
            start TEXT NOT NULL, end TEXT NOT NULL, status TEXT NOT NULL,
            priority INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            retry_at TEXT, error TEXT);
        CREATE TABLE IF NOT EXISTS collection.coverage (
            entity TEXT NOT NULL, dataset TEXT NOT NULL, start TEXT NOT NULL,
            end TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL,
            PRIMARY KEY(entity,dataset,start,end,evidence));
    ''')


def bounds(start, end):
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if a > b:
        raise ValueError('Reversed collection interval')
    return a, b


def enqueue(store, entity, dataset, inception, end, priority=10):
    """Split inception-to-date work into years; concurrent callers reuse stable IDs."""
    a, b = bounds(inception, end)
    if not entity or dataset not in {'market-prices', 'dividends'}:
        raise ValueError('Verified entity and supported dataset required')
    initialize(store)
    ids = []
    with store.db:
        while a <= b:
            stop = min(b, date(a.year, 12, 31))
            key = digest(encode([entity, dataset, a.isoformat(), stop.isoformat()]).encode())
            store.db.execute('''INSERT INTO collection.jobs
                (id,entity,dataset,start,end,status,priority) VALUES (?,?,?,?,?,'pending',?)
                ON CONFLICT(id) DO UPDATE SET priority=MIN(priority,excluded.priority)''',
                (key, entity, dataset, a.isoformat(), stop.isoformat(), priority))
            ids.append(key)
            a = stop + timedelta(days=1)
    return ids


def claim(store, now):
    """Atomic claim; running jobs are never stolen on a timer."""
    initialize(store)
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        row = store.db.execute('''SELECT * FROM collection.jobs
            WHERE status='pending' OR (status='retry' AND retry_at<=?)
            ORDER BY priority,start,id LIMIT 1''', (now,)).fetchone()
        if row is None:
            return None
        store.db.execute("UPDATE collection.jobs SET status='running',attempts=attempts+1 WHERE id=?", (row['id'],))
        return dict(row)


def finish(store, job_id, *, outcome, evidence=None, retry_at=None, error=None):
    """Only an adapter's explicit complete/no-dividends proof establishes coverage.

    Empty responses are partial by default, never inferred to mean no dividends.
    """
    if outcome not in {'complete', 'no_dividends', 'partial', 'retry'}:
        raise ValueError('Unknown collection outcome')
    if outcome in {'complete', 'no_dividends'} and not evidence:
        raise ValueError('Coverage requires archived evidence')
    if outcome == 'retry' and (not retry_at or not error):
        raise ValueError('Retry requires time and classified error')
    with store.db:
        row = store.db.execute('SELECT * FROM collection.jobs WHERE id=?', (job_id,)).fetchone()
        if row is None or row['status'] != 'running':
            raise ValueError('Only a claimed job can finish')
        if outcome == 'no_dividends' and row['dataset'] != 'dividends':
            raise ValueError('No-dividends is not a price outcome')
        if evidence:
            store.raw(evidence)  # Verify archived bytes, not a caller-supplied claim.
        if outcome in {'complete', 'no_dividends'}:
            store.db.execute('INSERT OR IGNORE INTO collection.coverage VALUES (?,?,?,?,?,?)',
                (row['entity'],row['dataset'],row['start'],row['end'],evidence,outcome))
        store.db.execute('UPDATE collection.jobs SET status=?,retry_at=?,error=? WHERE id=?',
                         (outcome,retry_at,error,job_id))


def coverage(store, entity, dataset, start, end):
    a, b = bounds(start,end)
    initialize(store)
    cursor, gaps = a, []
    rows = store.db.execute('''SELECT start,end FROM collection.coverage
        WHERE entity=? AND dataset=? ORDER BY start,end''',(entity,dataset))
    for row in rows:
        left,right = bounds(row['start'],row['end'])
        if right < cursor or left > b:
            continue
        if left > cursor:
            gaps.append({'start':cursor.isoformat(),'end':min(b,left-timedelta(days=1)).isoformat()})
        cursor = max(cursor,right+timedelta(days=1))
    if cursor <= b:
        gaps.append({'start':cursor.isoformat(),'end':b.isoformat()})
    return {'complete':not gaps,'missingIntervals':gaps,'start':start,'end':end}
