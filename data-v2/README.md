# Yieldloom core data v2

`data-v2` is the product-neutral shared data core for Yieldloom and DivGrow.
`public/data` is legacy market-history data and is deliberately outside this
contract. Price history, logos, chart periods, and UI state remain product
responsibilities. New catalog and official-dividend data are immutable releases.

## Layout

```text
data-v2/
  manifest.json                         # committed release pointer and hashes
  catalog/search-index.json              # browser-safe search directory
  catalog/instruments/{symbol}.json     # lazy-loaded core metadata
  providers/{provider}/events-{year}.json # authoritative, issuer-oriented rows
  tickers/{ticker}.json                 # small application read model
```

Object storage uses `core/releases/{releaseId}/`. The only mutable public
object is `core/current.json`, which points at an already-validated manifest.
A failed candidate must never replace that pointer. Collection state, raw
documents, and review artifacts belong below private `core/private/` storage,
not a browser release.

## Catalog migration

`data-v2/catalog-seed.json` is the checked-in migration seed created from the
DivGrow catalog. Refresh it only through the explicit migration command
(`npm run core:catalog:seed -- --input <DivGrow-nav.json>`), then review the
catalog diff. It carries only symbol, ISIN, market, currency, names, active
state, and an optional provider reference. Product fields such as `dataPaths`,
logo paths, periods, and prices are excluded. Pass the reviewed result to the
release builder:

```powershell
python scripts/data_v2/build_release.py --input data-v2/candidates/incremental-events.json --catalog-input data-v2/catalog-seed.json --release-id candidate-123 --output candidate-release
```

With `VITE_DATA_RELEASE_BASE_URL` configured as the public object-storage root,
the app loads `core/current.json`, the immutable manifest, and the small catalog
search index. It never falls back to `nav.json`.

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

`Collect incremental data v2 candidate` has an hourly weekday dispatcher and
can also be dispatched manually. The dispatcher reads the small, versioned
private state at `core/private/collection-state/current.json` and fetches only the
individual official URLs that are due. A source is identified by provider,
ticker (or `*` for an official aggregate page), and URL. Its state retains the
official publication timestamp when supplied by the issuer, the separate first
observation timestamp, source hash, failure/backoff state, and the next
expected announcement window.

Three or more consistent official publication timestamps enable a one-hour
window around the predicted UTC time; sources without reliable issuer timestamps
remain in observation mode and receive one daily safety check. Provider catalog
discovery is also limited to once per provider per UTC day. This keeps new
sources discoverable without repeatedly crawling every provider. Immutable state
snapshots live below `core/private/collection-state/snapshots/<run-id>/`.

The workflow uploads a complete candidate snapshot and an incremental review
report. An unchanged document reuses its last approved-state events; a missing
historical row is retained and marked for deletion review. A provider failure
does not discard candidates from other providers.

To publish a reviewed artifact, run `Publish approved data v2 release` on
`main`, pass `candidate_run_id` from the collection workflow, and use release
ID `candidate-<candidate_run_id>`. This validates the downloaded artifact and
only then moves `core/current.json`.

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
