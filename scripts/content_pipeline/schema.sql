PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS providers (
    slug TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    official_homepage TEXT NOT NULL,
    parser_version TEXT NOT NULL DEFAULT '1',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Candidate universe observed from an official provider catalog or an
-- official distribution source. Presence here is coverage evidence, not a
-- verified distribution event.
CREATE TABLE IF NOT EXISTS provider_funds (
    provider_slug TEXT NOT NULL REFERENCES providers(slug),
    ticker TEXT NOT NULL,
    official_url TEXT,
    source_type TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_collected_at TEXT,
    PRIMARY KEY (provider_slug, ticker)
);

CREATE INDEX IF NOT EXISTS idx_provider_funds_last_seen
    ON provider_funds (provider_slug, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS source_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_slug TEXT NOT NULL REFERENCES providers(slug),
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    local_path TEXT,
    status TEXT NOT NULL DEFAULT 'fetched'
        CHECK (status IN ('fetched', 'parsed', 'rejected', 'superseded')),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (provider_slug, source_url, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_source_documents_provider_fetched
    ON source_documents (provider_slug, fetched_at DESC);

CREATE TABLE IF NOT EXISTS collection_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_slug TEXT NOT NULL REFERENCES providers(slug),
    source_url TEXT NOT NULL,
    fetch_mode TEXT NOT NULL CHECK (fetch_mode IN ('http', 'browser', 'official_file')),
    status TEXT NOT NULL,
    retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
    http_status INTEGER,
    content_sha256 TEXT,
    event_count INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}',
    attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collection_attempts_provider_time
    ON collection_attempts (provider_slug, attempted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS distribution_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_slug TEXT NOT NULL REFERENCES providers(slug),
    ticker TEXT NOT NULL,
    fund_name TEXT,
    distribution_per_share TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    declared_date TEXT NOT NULL,
    ex_date TEXT NOT NULL,
    record_date TEXT,
    payable_date TEXT,
    frequency TEXT,
    roc_percent TEXT,
    source_document_id INTEGER NOT NULL REFERENCES source_documents(id),
    official_url TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'detected'
        CHECK (verification_status IN (
            'detected', 'official', 'cross_checked', 'needs_review', 'rejected'
        )),
    event_key TEXT NOT NULL UNIQUE,
    collected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_distribution_events_ticker_ex_date
    ON distribution_events (ticker, ex_date DESC);

CREATE INDEX IF NOT EXISTS idx_distribution_events_provider_declared
    ON distribution_events (provider_slug, declared_date DESC);

-- Every reported amount remains an immutable observation. Third-party values
-- are never promoted into distribution_events without an explicit review.
CREATE TABLE IF NOT EXISTS distribution_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_event_id INTEGER REFERENCES distribution_events(id) ON DELETE SET NULL,
    ticker TEXT NOT NULL,
    ex_date TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    amount_normalized TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    declared_date TEXT,
    record_date TEXT,
    payable_date TEXT,
    source_class TEXT NOT NULL CHECK (source_class IN (
        'issuer_official', 'exchange_official', 'market_infrastructure',
        'licensed_vendor', 'public_aggregator', 'manual'
    )),
    source_provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    content_sha256 TEXT,
    precision_digits INTEGER NOT NULL DEFAULT 0,
    verification_status TEXT NOT NULL CHECK (verification_status IN (
        'official', 'market_confirmed', 'cross_checked', 'third_party_only',
        'conflicting', 'needs_review', 'rejected'
    )),
    raw_json TEXT NOT NULL DEFAULT '{}',
    observed_at TEXT NOT NULL,
    UNIQUE (source_provider, ticker, ex_date, amount_raw, source_url)
);

CREATE INDEX IF NOT EXISTS idx_distribution_observations_ticker_date
    ON distribution_observations (ticker, ex_date DESC, source_class);

CREATE TABLE IF NOT EXISTS validation_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_document_id INTEGER NOT NULL REFERENCES source_documents(id),
    event_id INTEGER REFERENCES distribution_events(id),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_validation_findings_open
    ON validation_findings (resolved_at, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_slug TEXT REFERENCES providers(slug),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'warning', 'failed')),
    discovered_count INTEGER NOT NULL DEFAULT 0,
    parsed_count INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    report_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pipeline_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    step_name TEXT NOT NULL,
    provider_slug TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'warning', 'failed', 'skipped')),
    retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
    message TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run
    ON pipeline_run_steps (run_id, id);

CREATE TABLE IF NOT EXISTS content_performance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    content_key TEXT NOT NULL,
    ticker TEXT,
    topic TEXT NOT NULL,
    published_at TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
    likes INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
    comments INTEGER NOT NULL DEFAULT 0 CHECK (comments >= 0),
    clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
    subscribers INTEGER NOT NULL DEFAULT 0 CHECK (subscribers >= 0),
    watch_minutes REAL NOT NULL DEFAULT 0 CHECK (watch_minutes >= 0),
    production_minutes REAL NOT NULL DEFAULT 0 CHECK (production_minutes >= 0),
    imported_at TEXT NOT NULL,
    UNIQUE (platform, content_key)
);

CREATE INDEX IF NOT EXISTS idx_content_performance_topic_date
    ON content_performance (topic, published_at DESC);

-- Reconciliation is deliberately separate from the collection ledger.  A
-- detected difference must never mutate the legacy public data automatically.
CREATE TABLE IF NOT EXISTS public_data_reconciliation_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES distribution_events(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    ex_date TEXT NOT NULL,
    data_path TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'matched', 'missing_data_file', 'missing_date', 'amount_mismatch',
        'expected_only', 'needs_review', 'approved', 'rejected', 'applied'
    )),
    comparison_json TEXT NOT NULL DEFAULT '{}',
    proposed_patch_json TEXT NOT NULL DEFAULT '{}',
    reviewed_by TEXT,
    reviewed_at TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_public_data_reconciliation_status
    ON public_data_reconciliation_reviews (status, updated_at DESC);

-- A later scan may refresh unresolved proposals, but it must not erase the
-- reviewer, reason, or before/after hashes recorded by a terminal decision.
CREATE TRIGGER IF NOT EXISTS preserve_terminal_reconciliation_review
BEFORE UPDATE OF comparison_json ON public_data_reconciliation_reviews
WHEN OLD.status IN ('approved', 'rejected', 'applied')
  AND NEW.comparison_json <> OLD.comparison_json
BEGIN
    SELECT RAISE(IGNORE);
END;

-- Keep the previous official values when a source corrects an existing event.
CREATE TABLE IF NOT EXISTS distribution_event_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES distribution_events(id),
    superseded_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_distribution_revisions_event
    ON distribution_event_revisions(event_id, id);
CREATE TRIGGER IF NOT EXISTS preserve_distribution_revision
BEFORE UPDATE ON distribution_events
WHEN OLD.distribution_per_share IS NOT NEW.distribution_per_share
 OR OLD.record_date IS NOT NEW.record_date
 OR OLD.payable_date IS NOT NEW.payable_date
 OR OLD.frequency IS NOT NEW.frequency
 OR OLD.currency IS NOT NEW.currency
 OR OLD.roc_percent IS NOT NEW.roc_percent
 OR OLD.source_document_id IS NOT NEW.source_document_id
 OR OLD.verification_status IS NOT NEW.verification_status
BEGIN
    INSERT INTO distribution_event_revisions(event_id, superseded_at, snapshot_json)
    VALUES(OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), json_object(
        'provider_slug', OLD.provider_slug, 'ticker', OLD.ticker,
        'distribution_per_share', OLD.distribution_per_share,
        'currency', OLD.currency, 'declared_date', OLD.declared_date,
        'ex_date', OLD.ex_date, 'record_date', OLD.record_date,
        'payable_date', OLD.payable_date, 'frequency', OLD.frequency,
        'roc_percent', OLD.roc_percent, 'source_document_id', OLD.source_document_id,
        'official_url', OLD.official_url, 'verification_status', OLD.verification_status,
        'updated_at', OLD.updated_at));
END;

-- Register legacy history in the same ledger without copying millions of bars.
-- listing_key is stable for this migration; ticker alone is not an identity.
CREATE TABLE IF NOT EXISTS history_sources (
    listing_key TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    isin TEXT,
    currency TEXT,
    source_path TEXT NOT NULL UNIQUE,
    content_sha256 TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    first_price_date TEXT,
    last_price_date TEXT,
    first_dividend_date TEXT,
    last_dividend_date TEXT,
    price_basis TEXT NOT NULL DEFAULT 'legacy_unknown',
    registered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS corporate_action_observations (
    listing_key TEXT NOT NULL REFERENCES history_sources(listing_key),
    effective_date TEXT NOT NULL,
    raw_ratio TEXT NOT NULL,
    new_shares TEXT NOT NULL,
    old_shares TEXT NOT NULL,
    action_type TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'legacy_unverified',
    source_sha256 TEXT NOT NULL,
    PRIMARY KEY(listing_key, effective_date, raw_ratio)
);
CREATE TABLE IF NOT EXISTS frequency_regime_observations (
    listing_key TEXT NOT NULL REFERENCES history_sources(listing_key),
    effective_date TEXT NOT NULL,
    previous_frequency TEXT,
    next_frequency TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'legacy_unverified',
    source_sha256 TEXT NOT NULL,
    PRIMARY KEY(listing_key, effective_date, next_frequency)
);

PRAGMA user_version = 9;
