# Thumbnail R2 read models

This project consumes market-history objects maintained by
[totobubu/totobubu.github.io](https://github.com/totobubu/totobubu.github.io).
The upstream `Market Data v2 US` workflow runs `tasks/updateHistoricalUsData.js`
after the US close and uploads changed files to R2. Its collector restores
existing rows from disk or R2, merges by date, and appends prices from the last
observed date. Our refresh reads that R2 directory and never changes its objects.

The upstream Yahoo chart collector uses daily `indicators.quote.close`, not
`adjclose`. Incremental updates do not prove that older rows have been rebased
after each split. Upstream split type labels are not used for arithmetic here.
We retain event date/ratio and mark the adjustment basis `upstream_unverified`.
Cards defer comparison and entry-efficiency calculations when their price
window contains a split. Broker fills and transaction ledgers are never rewritten
by this pipeline; their original execution prices and quantities have a separate
meaning from adjusted chart prices.

## Storage contract

All new generated data lives in R2, not Git or Actions artifacts:

```
thumbnail/v1/current.json
thumbnail/v1/releases/<manifest-sha256>/manifest.json
thumbnail/v1/objects/<encoded-symbol>/<version>/summary.json
thumbnail/v1/objects/<encoded-symbol>/<version>/comparison-1y.json
thumbnail/v1/objects/<encoded-symbol>/<version>/entry-efficiency.json
thumbnail/v1/objects/<encoded-symbol>/<version>/source-coverage.json
```

The manifest reuses unchanged object references. Each changed ticker receives
immutable objects with per-file hashes, uploaded and read back for hash verification before the
manifest and pointer are published. Old manifests and objects remain available.
A corrupt current manifest aborts publication. A source failure or lost historical
price date preserves that ticker's previous entry and fails the workflow visibly;
other verified tickers may still update. Initial failures are not published.

`source-coverage` keeps every observed actual price date to detect interior gaps
and moving ten-year cutoffs. Summary keeps source key, SHA-256, size, first/last
price date and row count. This is a loss detector, not a second archive of every
historic price: the full source history remains the upstream owner's responsibility.
The date/close read model preserves source prices unchanged; it never promotes
upstream dividend observations to official dividends.

The comparison model keeps one year plus the preceding observed close. The
entry model keeps 37 calendar months, including the twelve-month dividend
lookback for the last 24 monthly entry samples. Source dividends, OHLCV,
market cap and forecast rows are excluded. Official dividend events are joined
from an approved core release, or the existing public ledger during migration.

## Running

Node 22 or newer and `npm ci` are required. Read-only verification writes no
objects and keeps generated models in memory:

```sh
THUMBNAIL_SOURCE_BASE_URL=https://SOURCE_R2_ROOT \
  node scripts/thumbnail_pipeline/refresh.mjs --dry-run --symbols AMDY,TSLY,TOPW,AAPL,TSLA
```

The default source directory is the independently maintained
`data-v2/market-sources.json` in this repository. Refresh does not fetch upstream
`nav.json`. `--nav <path>` remains an explicit migration/debug override only.
Update the owned market-source registry when registering a ticker.
The run accepts `--as-of YYYY-MM-DD` for reproducible validation and
`--concurrency 1..8` to bound ticker processing (default 8). Source reads and
per-ticker verification run concurrently; the public pointer still moves only
after all selected tickers have completed. Manifest entries are sorted before
hashing so completion order does not change the release identity.
Conditional GET with the last ETag and then SHA-256 comparison skips unchanged
sources. Bump `generatorVersion` when changing the transformation to rebuild
unchanged sources with the new algorithm. This still reads changed full source objects in the background; the API
reads compact derivatives. Unknown symbols can use Yahoo recent quotes without
inserting them into the upstream catalog or replacing a historical series.

Publishing additionally requires server-side `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` for the destination.
The code rejects every write outside `thumbnail/v1/` and issues no deletions.
Use a separate destination bucket/token if storage-level isolation is needed;
a prefix guard in application code is not an R2 token permission boundary.

The `Refresh thumbnail projections` workflow publishes only from main, with a
single concurrency group, at 03:30 UTC Tuesday–Saturday (12:30 KST). It reads
`vars.THUMBNAIL_SOURCE_BASE_URL`, then `secrets.R2_PUBLIC_URL`, then
`vars.VITE_R2_PUBLIC_URL`. A nonempty dispatch input overrides
`vars.THUMBNAIL_PROJECTION_SYMBOLS`; leaving the input blank uses that repository
variable. When both are unset, it falls back to the five pilot tickers. Set `ALL`
after reviewing the pilot to expand to the source directory.

The upstream collector is scheduled at 23:00 UTC Monday–Friday, but GitHub
schedule delays can push its R2 publication into the following UTC day. On
October 15, 2026 it finished at 01:54 UTC, after our previous 01:30 UTC schedule.
The later schedule provides room for those observed delays; it is not an
upstream-completion dependency. If collection finishes later still, compare
source price dates with the published summary and rerun the refresh after the
upstream upload. Scheduled Actions can also start later than their cron time.
No generated data is committed or attached as artifacts.

## API migration and rollout

1. Run the five-ticker dry run and review the source contract.
2. Publish the five-ticker derivative set through the workflow using configured
   destination credentials; verify `thumbnail/v1/current.json` publicly.
3. Set `THUMBNAIL_PROJECTION_BASE_URL` to the destination public R2 root on the API
   host, then redeploy. The projection directory is cached for 60 seconds.
4. Expand refresh to the source directory after checking errors and latency.

The API prefers the compact model, uses existing source R2 paths during rollout,
and uses a five-day Yahoo chart request only as a quote supplement. Source and
ledger requests have time limits; a ledger outage does not hide a working price.
Identical concurrent ticker loads share a promise. Main responses omit the
primary ticker from `series` and load the underlying only when rivals are selected.
Unknown tickers return 404, upstream outages with no usable data return 503, and
saved last-good quotes can render with stale status. Price freshness is
conservatively based on elapsed calendar days, not a full exchange holiday calendar.

The existing snapshot facility optionally writes last-good API responses under
`yieldloom/thumbnail-snapshots/v1/`; it does not modify `data/` either. It requires
API-host R2 credentials separately from the Actions publisher.

## Core data v2

Publisher and consumers use `core/current.json` with schemaVersion 2. Set
`DATA_RELEASE_BASE_URL` on the server (or its existing VITE counterpart) and
`VITE_DATA_RELEASE_BASE_URL` at frontend build time only after an approved release
is actually published. Server ticker histories are checked against manifest
hashes. Both official and cross-checked events are accepted; review-only rows
are excluded.

Production validation rejects the empty bootstrap, nonfinite/nonpositive amounts,
changed decimal precision, invalid source evidence, ticker identity mismatches,
duplicate ticker events and broken manifest references. The publisher validates
itself and refuses to overwrite an existing immutable release ID. CI may use
`--allow-bootstrap` to inspect the migration placeholder; publication never does.
The candidate from collection run `38518825012` was downloaded and validated
against the strengthened release gate: 4,377 events across 91 tickers and four
providers, in 2,292 release files. Its source report records 39 failures among
45 selected sources despite a successful workflow result. Most failures came
from browser collectors, whose workflow lacked Node dependencies and Chromium.
The collection workflow now installs that runtime and reports source failures
as a failed run after preserving the review artifact. Global X payload parsing
and the REX table layout also require source-specific review. No core release
has been approved or published on the basis of that partial collection.
Browser-enabled run `38539695637` confirms the runtime fix: 154 newly observed
events, source failures reduced from 39 to 13, and a validated candidate with
4,529 events across 106 tickers and five providers. Its remaining failures are
provider layout changes, unavailable dividend tables, and a Schwab HTTP 403.
The workflow correctly reports failure after saving the candidate artifact.

## Verification

Run:

```sh
node --test tests/thumbnail-projection.test.mjs tests/thumbnail-data.test.mjs tests/rival_comparison.test.mjs tests/entry_income_efficiency.test.mjs
python -m unittest discover -s tests/data_v2 -p 'test_*.py'
npm run build
```

Tests compare compact and full-history calculation results, reject ten-year
cutoffs/interior gaps, preserve the previous pointer after upload failure, verify
read-model hashes, and exercise price/ledger failures and Yahoo symbol handling.
The five real R2 samples were validated without publishing: AAPL's approximately
3.29 MB source produces a 0.7 KB summary and 35.7 KB entry price model. Models are
not saved in Git. Real production latency must be measured after activation.
