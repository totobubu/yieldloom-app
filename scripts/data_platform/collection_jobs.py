"""Durable, bounded collection jobs in the existing checkpointed state database.

Workers must hold the platform writer lock. No HTTP or publication is performed here.
A successful request is not evidence of complete historical coverage.
"""
from datetime import date, timedelta
from uuid import uuid4
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
    columns = {row['name'] for row in store.db.execute('PRAGMA collection.table_info(jobs)')}
    for name, definition in [('source', "TEXT NOT NULL DEFAULT 'default'"), ('owner', 'TEXT')]:
        if name not in columns:
            store.db.execute(f'ALTER TABLE collection.jobs ADD COLUMN {name} {definition}')
    store.db.execute('CREATE TABLE IF NOT EXISTS collection.source_cooldowns (source TEXT PRIMARY KEY, retry_at TEXT NOT NULL)')
    store.db.commit()


def bounds(start, end):
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if a > b:
        raise ValueError('Reversed collection interval')
    return a, b


def enqueue(store, entity, dataset, inception, end, priority=10, source="default"):
    """Split inception-to-date work into years; concurrent callers reuse stable IDs."""
    a, b = bounds(inception, end)
    if not entity or dataset not in {'market-prices', 'dividends'}:
        raise ValueError('Verified entity and supported dataset required')
    initialize(store)
    if not source:
        raise ValueError('Source required')
    ids = []
    # Subtract every existing interval, including running/retry/partial jobs.
    # A later request extending today's end adds only the uncovered tail.
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        existing = store.db.execute("SELECT * FROM collection.jobs WHERE entity=? AND dataset=? AND source=? ORDER BY start,end",
                                    (entity,dataset,source)).fetchall()
        gaps, cursor = [], a
        for row in existing:
            left,right = bounds(row['start'],row['end'])
            if right < a or left > b:
                continue
            ids.append(row['id'])
            store.db.execute('UPDATE collection.jobs SET priority=MIN(priority,?) WHERE id=?',(priority,row['id']))
            if left > cursor:
                gaps.append((cursor,min(b,left-timedelta(days=1))))
            cursor = max(cursor,right+timedelta(days=1))
        if cursor <= b:
            gaps.append((cursor,b))
        for start,stop in gaps:
            while start <= stop:
                last = min(stop,date(start.year,12,31))
                key = digest(encode([entity,dataset,source,start.isoformat(),last.isoformat()]).encode())
                store.db.execute("""INSERT INTO collection.jobs
                    (id,entity,dataset,start,end,status,priority,source) VALUES (?,?,?,?,?,'pending',?,?)""",
                    (key,entity,dataset,start.isoformat(),last.isoformat(),priority,source))
                ids.append(key)
                start = last+timedelta(days=1)
    return ids


def claim(store, now, source="default"):
    """Atomic claim; running jobs are never stolen on a timer."""
    initialize(store)
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        busy = store.db.execute("SELECT 1 FROM collection.jobs WHERE source=? AND status='running'", (source,)).fetchone()
        cooldown = store.db.execute('SELECT retry_at FROM collection.source_cooldowns WHERE source=?',(source,)).fetchone()
        if busy or (cooldown and cooldown['retry_at'] > now):
            return None
        row = store.db.execute("""SELECT * FROM collection.jobs WHERE source=?
            AND (status='pending' OR (status='retry' AND retry_at<=?))
            ORDER BY priority,start,id LIMIT 1""", (source,now)).fetchone()
        if row is None:
            return None
        owner = uuid4().hex
        store.db.execute("UPDATE collection.jobs SET status='running',attempts=attempts+1,owner=? WHERE id=?", (owner,row['id']))
        return {**dict(row),'owner':owner,'attempts':row['attempts']+1,'status':'running'}


def finish(store, job_id, *, owner, outcome, evidence=None, retry_at=None, error=None):
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
        if row is None or row['status'] != 'running' or row['owner'] != owner:
            raise ValueError('Only a claimed job can finish')
        if outcome == 'retry':
            store.db.execute('INSERT INTO collection.source_cooldowns VALUES (?,?) ON CONFLICT(source) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)',(row['source'],retry_at))
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


def recover(store, job_id, owner, *, worker_stopped=False):
    """Explicit recovery only after operator confirms the previous worker stopped."""
    if not worker_stopped:
        raise ValueError('Worker termination must be confirmed')
    with store.db:
        result = store.db.execute("UPDATE collection.jobs SET status='pending',owner=NULL WHERE id=? AND status='running' AND owner=?",(job_id,owner))
        if result.rowcount != 1:
            raise ValueError('Stale recovery owner')
