# Dividend evidence verification

Run `npm run content:verify-dividends` from the application directory. For a targeted audit:

```sh
python scripts/content_pipeline/enrich_dividends.py --ticker JEPI --limit 1
```

The provider-refresh workflow runs the same audit after refresh. Raw evidence, source documents, observations, audit results and rotation state are retained in the existing content database and raw directory. The JSON summary is written to `var/content-studio/dividend-verification.json` and uploaded as a workflow artifact. This process never overwrites canonical dividends or promotes external observations to official confirmation.

Sources:

- Official provider adapters remain the primary source. Optional `BRAVE_SEARCH_API_KEY` enables discovery of additional documents on their approved official domains. Search snippets are not parsed as dividends. Discovered PDFs are retained for further parsing, with `parser_required` recorded.
- Yahoo supplies independent ex-date and amount evidence, with symbol, currency, exchange timezone and stock-split checks.
- Investing.com uses explicitly reviewed security URLs in `data-v2/verification-sources.json`; currently JEPI is mapped.
- Seeking Alpha uses `https://seekingalpha.com/symbol/{TICKER}/dividends/history` for registered USD securities on supported US exchanges. Public HTML dividend tables supply ex-date, amount and available record/payment dates. Marketing query parameters are omitted. By default at most five Seeking Alpha pages are requested per batch (`--reference-limit`); the universe rotates between runs.

Seeking Alpha can require JavaScript, cookies or a subscription. A page without a readable public table is recorded as an error and supplies no observations. The adapter does not bypass access restrictions or infer amounts from page headings. Adding a reference does not guarantee live collection from that site.

Comparisons require the exact ex-date and currency, use bounded decimal tolerance, and flag ambiguous rows and unresolved split basis. Missing fields remain unavailable. Existing Toss ingestion is unchanged; this command does not add a new Toss API collector. Securities without a supported official adapter can accumulate auxiliary evidence, but official discovery requires an adapter first.
