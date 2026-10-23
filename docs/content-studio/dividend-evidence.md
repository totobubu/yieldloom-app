# Dividend evidence verification

Run `npm run content:verify-dividends` from the application directory. For a targeted audit:

```sh
python scripts/content_pipeline/enrich_dividends.py --ticker JEPI --limit 1
```

The provider-refresh workflow runs the same audit after refresh. Raw evidence, source documents, observations, audit results and rotation state are retained in the existing content database and raw directory. The JSON summary is written to `var/content-studio/dividend-verification.json` and uploaded as a workflow artifact. This process never overwrites canonical dividends or promotes external observations to official confirmation.

Sources:

- Official provider adapters remain the primary source. Optional `BRAVE_SEARCH_API_KEY` enables discovery of additional documents on their approved official domains. Search snippets are not parsed as dividends. Discovered PDFs are retained for further parsing, with `parser_required` recorded.
- A ticker without an existing provider mapping enters SEC official-source discovery. Set the GitHub Actions secret `SEC_USER_AGENT` to an SEC-compliant identity containing the application name and monitored contact address. The discovery step resolves the ticker to a CIK and records submissions and companyfacts evidence, but does not infer ex-dividend dates or create canonical distribution events.
- Korean markets use OpenDART official-source discovery. Set `OPENDART_API_KEY`; the key is used only for requests and is never included in stored source URLs, metadata, reports, or public exports. The first stage resolves the six-digit stock code to a DART corporation code and records the official company profile without creating dividend events.
- Massive individual-plan data is not used by the production collector, persisted, or published. Any future vendor fallback requires a business agreement that expressly permits server storage, application use, and redistribution.
- Yahoo supplies independent ex-date and amount evidence, with symbol, currency, exchange timezone and stock-split checks.
- Investing.com uses explicitly reviewed security URLs in `data-v2/verification-sources.json`; currently JEPI is mapped.
- Seeking Alpha uses `https://seekingalpha.com/symbol/{TICKER}/dividends/history` for registered USD securities on supported US exchanges. Public HTML dividend tables supply ex-date, amount and available record/payment dates. Marketing query parameters are omitted. By default at most five Seeking Alpha pages are requested per batch (`--reference-limit`); the universe rotates between runs.

Seeking Alpha can require JavaScript, cookies or a subscription. A page without a readable public table is recorded as an error and supplies no observations. The adapter does not bypass access restrictions or infer amounts from page headings. Adding a reference does not guarantee live collection from that site.

Comparisons require the exact ex-date and currency, use bounded decimal tolerance, and flag ambiguous rows and unresolved split basis. Missing fields remain unavailable. Existing Toss ingestion is unchanged; this command does not add a new Toss API collector. Securities without a supported official adapter can accumulate auxiliary evidence, but official discovery requires an adapter first.
