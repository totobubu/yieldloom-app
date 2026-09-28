from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from decimal import Decimal

from .models import DistributionEvent, SourceDocument, utc_now_iso


DEFAULT_DB_PATH = Path("var/content-studio/distribution-events.sqlite")


class ContentDatabase:
    def __init__(self, path: str | Path = DEFAULT_DB_PATH):
        self.path = Path(path)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        schema_path = Path(__file__).with_name("schema.sql")
        with self.connect() as connection:
            connection.executescript(schema_path.read_text(encoding="utf-8"))

    def upsert_provider(
        self,
        slug: str,
        display_name: str,
        official_homepage: str,
        parser_version: str = "1",
        enabled: bool = True,
    ) -> None:
        now = utc_now_iso()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO providers (
                    slug, display_name, official_homepage, parser_version,
                    enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                    display_name = excluded.display_name,
                    official_homepage = excluded.official_homepage,
                    parser_version = excluded.parser_version,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                """,
                (
                    slug.strip().lower(),
                    display_name.strip(),
                    official_homepage.strip(),
                    parser_version,
                    int(enabled),
                    now,
                    now,
                ),
            )

    def add_source_document(self, document: SourceDocument) -> int:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO source_documents (
                    provider_slug, source_url, source_type, content_sha256,
                    published_at, fetched_at, local_path, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_slug, source_url, content_sha256)
                DO UPDATE SET fetched_at = excluded.fetched_at
                """,
                (
                    document.provider_slug,
                    document.source_url,
                    document.source_type,
                    document.content_sha256,
                    document.published_at,
                    document.fetched_at,
                    document.local_path,
                    document.metadata_json,
                ),
            )
            row = connection.execute(
                """
                SELECT id FROM source_documents
                WHERE provider_slug = ? AND source_url = ? AND content_sha256 = ?
                """,
                (document.provider_slug, document.source_url, document.content_sha256),
            ).fetchone()
            return int(row["id"])

    def upsert_provider_fund(
        self,
        provider_slug: str,
        ticker: str,
        official_url: str | None,
        source_type: str,
        *,
        collected: bool = False,
    ) -> None:
        """Record official catalog coverage separately from dividend truth."""
        stamp = utc_now_iso()
        normalized = ticker.strip().upper()
        if not normalized:
            return
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO provider_funds (
                    provider_slug, ticker, official_url, source_type,
                    first_seen_at, last_seen_at, last_collected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_slug, ticker) DO UPDATE SET
                    official_url = COALESCE(excluded.official_url, provider_funds.official_url),
                    source_type = excluded.source_type,
                    last_seen_at = excluded.last_seen_at,
                    last_collected_at = COALESCE(excluded.last_collected_at, provider_funds.last_collected_at)
                """,
                (
                    provider_slug, normalized, official_url, source_type,
                    stamp, stamp, stamp if collected else None,
                ),
            )

    def add_collection_attempt(
        self,
        provider_slug: str,
        source_url: str,
        fetch_mode: str,
        status: str,
        *,
        retryable: bool = False,
        http_status: int | None = None,
        content_sha256: str | None = None,
        event_count: int = 0,
        message: str = "",
        details: dict | None = None,
    ) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO collection_attempts (
                    provider_slug, source_url, fetch_mode, status, retryable,
                    http_status, content_sha256, event_count, message,
                    details_json, attempted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    provider_slug, source_url, fetch_mode, status, int(retryable),
                    http_status, content_sha256, event_count, message,
                    json.dumps(details or {}, ensure_ascii=False, sort_keys=True),
                    utc_now_iso(),
                ),
            )
            return int(cursor.lastrowid)

    def upsert_distribution_event(
        self, event: DistributionEvent, source_document_id: int,
        *, source_class: str | None = None,
    ) -> int:
        self.upsert_provider_fund(
            event.provider_slug,
            event.ticker,
            event.official_url,
            "official_distribution_event",
            collected=True,
        )
        now = utc_now_iso()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO distribution_events (
                    provider_slug, ticker, fund_name, distribution_per_share,
                    currency, declared_date, ex_date, record_date, payable_date,
                    frequency, roc_percent, source_document_id, official_url,
                    verification_status, event_key, collected_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(event_key) DO UPDATE SET
                    fund_name = excluded.fund_name,
                    distribution_per_share = excluded.distribution_per_share,
                    currency = excluded.currency,
                    record_date = excluded.record_date,
                    payable_date = excluded.payable_date,
                    frequency = excluded.frequency,
                    roc_percent = excluded.roc_percent,
                    source_document_id = excluded.source_document_id,
                    official_url = excluded.official_url,
                    verification_status = excluded.verification_status,
                    updated_at = excluded.updated_at
                """,
                (
                    event.provider_slug,
                    event.ticker,
                    event.fund_name,
                    event.distribution_per_share,
                    event.currency,
                    event.declared_date,
                    event.ex_date,
                    event.record_date,
                    event.payable_date,
                    event.frequency,
                    event.roc_percent,
                    source_document_id,
                    event.official_url,
                    event.verification_status,
                    event.event_key,
                    event.collected_at,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT id FROM distribution_events WHERE event_key = ?",
                (event.event_key,),
            ).fetchone()
            event_id = int(row["id"])
            source = connection.execute(
                "SELECT content_sha256 FROM source_documents WHERE id = ?",
                (source_document_id,),
            ).fetchone()
            resolved_class = source_class or (
                "exchange_official" if event.verification_status == "cross_checked"
                else "issuer_official"
            )
            observation_status = {
                "official": "official",
                "cross_checked": "cross_checked",
                "needs_review": "needs_review",
            }.get(event.verification_status, "needs_review")
            raw_amount = str(event.distribution_per_share)
            connection.execute(
                """
                INSERT INTO distribution_observations (
                    canonical_event_id, ticker, ex_date, amount_raw,
                    amount_normalized, currency, declared_date, record_date,
                    payable_date, source_class, source_provider, source_url,
                    content_sha256, precision_digits, verification_status,
                    raw_json, observed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
                ON CONFLICT(source_provider, ticker, ex_date, amount_raw, source_url)
                DO UPDATE SET canonical_event_id = excluded.canonical_event_id,
                              content_sha256 = excluded.content_sha256,
                              observed_at = excluded.observed_at
                """,
                (
                    event_id, event.ticker, event.ex_date, raw_amount,
                    format(Decimal(raw_amount), "f"), event.currency,
                    event.declared_date, event.record_date, event.payable_date,
                    resolved_class, event.provider_slug, event.official_url,
                    source["content_sha256"] if source else None,
                    len(raw_amount.partition(".")[2]), observation_status,
                    event.collected_at,
                ),
            )
            return event_id

    def add_distribution_observation(self, observation: dict) -> int:
        """Store a non-canonical source observation without publishing it."""
        raw_amount = str(observation["amount_raw"])
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO distribution_observations (
                    canonical_event_id, ticker, ex_date, amount_raw,
                    amount_normalized, currency, declared_date, record_date,
                    payable_date, source_class, source_provider, source_url,
                    content_sha256, precision_digits, verification_status,
                    raw_json, observed_at
                ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_provider, ticker, ex_date, amount_raw, source_url)
                DO UPDATE SET raw_json=excluded.raw_json, observed_at=excluded.observed_at
                """,
                (
                    str(observation["ticker"]).upper(), observation["ex_date"],
                    raw_amount, format(Decimal(raw_amount), "f"),
                    observation.get("currency", "USD"), observation.get("declared_date"),
                    observation.get("record_date"), observation.get("payable_date"),
                    observation["source_class"], observation["source_provider"],
                    observation["source_url"], observation.get("content_sha256"),
                    len(raw_amount.partition(".")[2]),
                    observation.get("verification_status", "third_party_only"),
                    json.dumps(observation.get("raw", {}), ensure_ascii=False, sort_keys=True),
                    observation.get("observed_at", utc_now_iso()),
                ),
            )
            row = connection.execute(
                """SELECT id FROM distribution_observations
                   WHERE source_provider=? AND ticker=? AND ex_date=?
                     AND amount_raw=? AND source_url=?""",
                (
                    observation["source_provider"], str(observation["ticker"]).upper(),
                    observation["ex_date"], raw_amount, observation["source_url"],
                ),
            ).fetchone()
            return int(row["id"])

    def summary(self) -> dict[str, int]:
        tables = (
            "providers",
            "provider_funds",
            "source_documents",
            "collection_attempts",
            "distribution_events",
            "distribution_observations",
            "validation_findings",
            "pipeline_runs",
            "content_performance",
        )
        with self.connect() as connection:
            return {
                table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
                for table in tables
            }

    def dashboard_snapshot(self, limit: int = 100) -> dict:
        with self.connect() as connection:
            counts = self.summary()
            provider_rows = connection.execute(
                """
                SELECT
                    p.slug,
                    p.display_name,
                    p.enabled,
                    MAX(s.fetched_at) AS last_fetched_at,
                    COUNT(DISTINCT s.id) AS source_count,
                    COUNT(DISTINCT e.id) AS event_count,
                    (SELECT COUNT(*) FROM provider_funds pf
                     WHERE pf.provider_slug = p.slug) AS catalog_ticker_count,
                    COUNT(DISTINCT e.ticker) AS collected_ticker_count,
                    (SELECT a.status FROM collection_attempts a
                     WHERE a.provider_slug = p.slug
                     ORDER BY a.attempted_at DESC, a.id DESC LIMIT 1) AS last_attempt_status,
                    (SELECT a.message FROM collection_attempts a
                     WHERE a.provider_slug = p.slug
                     ORDER BY a.attempted_at DESC, a.id DESC LIMIT 1) AS last_attempt_message,
                    (SELECT a.fetch_mode FROM collection_attempts a
                     WHERE a.provider_slug = p.slug
                     ORDER BY a.attempted_at DESC, a.id DESC LIMIT 1) AS last_fetch_mode,
                    (SELECT a.attempted_at FROM collection_attempts a
                     WHERE a.provider_slug = p.slug
                     ORDER BY a.attempted_at DESC, a.id DESC LIMIT 1) AS last_attempt_at
                FROM providers p
                LEFT JOIN source_documents s ON s.provider_slug = p.slug
                LEFT JOIN distribution_events e ON e.provider_slug = p.slug
                GROUP BY p.slug, p.display_name, p.enabled
                ORDER BY p.display_name
                """
            ).fetchall()
            fund_rows = connection.execute(
                """
                SELECT pf.provider_slug, pf.ticker, pf.official_url,
                       pf.source_type, pf.first_seen_at, pf.last_seen_at,
                       pf.last_collected_at,
                       CASE WHEN EXISTS (
                           SELECT 1 FROM distribution_events e
                           WHERE e.provider_slug = pf.provider_slug
                             AND e.ticker = pf.ticker
                       ) THEN 'collected' ELSE 'catalog_only' END AS coverage_status
                FROM provider_funds pf
                ORDER BY pf.provider_slug, pf.ticker
                """
            ).fetchall()
            event_rows = connection.execute(
                """
                SELECT
                    id, provider_slug, ticker, fund_name,
                    distribution_per_share, currency, declared_date, ex_date,
                    record_date, payable_date, frequency, roc_percent,
                    official_url, verification_status, collected_at
                FROM distribution_events
                ORDER BY declared_date DESC, provider_slug, ticker
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            finding_rows = connection.execute(
                """
                SELECT
                    f.id, f.severity, f.code, f.message, f.created_at,
                    e.provider_slug, e.ticker
                FROM validation_findings f
                LEFT JOIN distribution_events e ON e.id = f.event_id
                WHERE f.resolved_at IS NULL
                ORDER BY
                    CASE f.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                    f.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            run_rows = connection.execute(
                """
                SELECT
                    id, provider_slug, started_at, finished_at, status,
                    discovered_count, parsed_count, accepted_count, rejected_count
                FROM pipeline_runs
                ORDER BY started_at DESC
                LIMIT 20
                """
            ).fetchall()
        return {
            "generatedAt": utc_now_iso(),
            "counts": counts,
            "providers": [dict(row) for row in provider_rows],
            "providerFunds": [dict(row) for row in fund_rows],
            "recentEvents": [dict(row) for row in event_rows],
            "openFindings": [dict(row) for row in finding_rows],
            "recentRuns": [dict(row) for row in run_rows],
        }

    def add_validation_finding(
        self,
        source_document_id: int,
        severity: str,
        code: str,
        message: str,
        *,
        event_id: int | None = None,
        details: dict | None = None,
    ) -> int:
        if severity not in {"info", "warning", "error"}:
            raise ValueError(f"invalid finding severity: {severity}")
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO validation_findings (
                    source_document_id, event_id, severity, code, message,
                    details_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source_document_id,
                    event_id,
                    severity,
                    code,
                    message,
                    json.dumps(details or {}, ensure_ascii=False, sort_keys=True),
                    utc_now_iso(),
                ),
            )
            return int(cursor.lastrowid)

    def start_pipeline_run(self) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO pipeline_runs (started_at, status) VALUES (?, 'running')",
                (utc_now_iso(),),
            )
            return int(cursor.lastrowid)

    def recover_interrupted_pipeline_runs(self) -> int:
        """Close runs left running by a terminated local process before the next run."""
        with self.connect() as connection:
            cursor = connection.execute(
                """UPDATE pipeline_runs
                SET finished_at = ?, status = 'failed',
                    report_json = '{"reason":"interrupted before completion","retryable":true}'
                WHERE status = 'running'""",
                (utc_now_iso(),),
            )
            return cursor.rowcount

    def finish_pipeline_run(self, run_id: int, status: str, report: dict) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE pipeline_runs SET finished_at = ?, status = ?, report_json = ? WHERE id = ?",
                (utc_now_iso(), status, json.dumps(report, ensure_ascii=False, sort_keys=True), run_id),
            )

    def add_pipeline_step(
        self, run_id: int, step_name: str, status: str, *, provider_slug: str | None = None,
        retryable: bool = False, message: str = "", details: dict | None = None,
    ) -> None:
        now = utc_now_iso()
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO pipeline_run_steps
                (run_id, step_name, provider_slug, status, retryable, message, details_json, started_at, finished_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (run_id, step_name, provider_slug, status, int(retryable), message,
                 json.dumps(details or {}, ensure_ascii=False, sort_keys=True), now, now),
            )
