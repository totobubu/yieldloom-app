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
