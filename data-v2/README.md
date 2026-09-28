# Yieldloom data v2

`public/data` is legacy market-history data and is deliberately not part of this
repository. It remains recoverable in the legacy checkout. New dividend data is
released as an immutable snapshot in object storage.

## Layout

```text
data-v2/
  manifest.json                         # committed release pointer and hashes
  providers/{provider}/events-{year}.json # authoritative, issuer-oriented rows
  tickers/{ticker}.json                 # small application read model
```

Object storage uses the same layout under `snapshots/{releaseId}/`. The only
mutable object is `releases/current.json`, which points at an already-validated
manifest. A failed candidate must never replace that pointer.

## Amount rule

Every distribution amount is represented by an object like this:

```json
{
  "raw": "0.25660",
  "decimal": "0.25660",
  "currency": "USD"
}
```

`raw` is the issuer's exact textual value, including trailing zeroes. `decimal`
is a decimal string for exact calculation; JavaScript and Python binary floats
must not be used to rewrite either field. Formatting for a UI is a separate
operation and must not alter released data.

## Release gate

Run `python scripts/data_v2/validate_snapshot.py` before publishing a release.
It verifies manifest hashes and rejects amounts whose raw/decimal strings are
not exact decimal representations. A publisher should download only the current
manifest plus changed files, create a new immutable snapshot, validate it, then
atomically update the current-release pointer after human approval.

## Incremental collection

`Collect incremental data v2 candidate` runs at 08:30 Asia/Seoul on weekdays
and can also be dispatched manually. It reads the small, versioned state at
`yieldloom/v2/collection-state/current.json`, fetches official documents to
compare their hashes, and parses only changed documents. Immutable state
snapshots live below `collection-state/snapshots/<run-id>/`.

The workflow uploads a complete candidate snapshot and an incremental review
report. An unchanged document reuses its last approved-state events; a missing
historical row is retained and marked for deletion review. A provider failure
does not discard candidates from other providers.

To publish a reviewed artifact, run `Publish approved data v2 release` on
`main`, pass `candidate_run_id` from the collection workflow, and use release
ID `candidate-<candidate_run_id>`. This validates the downloaded artifact and
only then moves `releases/current.json`.

## Official email screenshot evidence

Email screenshots are never placed under `public/`, data-v2 releases, or the
public data R2 bucket. Use a **separate private R2 bucket** and the local
command below after configuring its four `EVIDENCE_R2_*` environment variables:

```powershell
python scripts/data_v2/ingest_email_evidence.py .\notice.png --provider neos --received-at 2026-09-28T08:00:00+09:00 --ticker-hint SPYI --output evidence-receipt-spyi.json
```

The command returns a SHA-256 evidence ID. Dispatch `Analyze uploaded email
evidence` with that ID to re-run OCR from the private original and compare its
hints against the current official collection state. This produces a private
review artifact only; it cannot add, modify, or publish a dividend event.
