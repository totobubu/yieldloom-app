# Summary account subset — phase75

Base frozen commit: b708e33. Worktree /workspace/yieldloom-summary-phase75, branch fix/stitch-summary-subset-phase75. This is a local independent implementation; no push/PR/merge/deployment, live account/customer PDF access, API/permission/cache/financial helper change.

## Change
- FamilyPortfolioView summary-only account selector now follows source checkboxes, 全 selection and reset. null means all currently server-returned accounts; [] means an intentional empty selection. Explicit selections intersect currently returned account IDs; removing the last selected account leaves empty rather than widening to all. Session-user change resets this local view state.
- Existing summarizeSelection array projection reused unchanged. Global edit account/profile, other tabs, API contracts, financial arithmetic and session cache unchanged. No IDs added to URL/log/storage.
- PortfolioValuation receives optional scopeAccountIds for presentation/pagination only; legacy single scopeAccountId remains compatible. Its positions prop, quote watcher, quote requests/cache remain unchanged. Filtering cannot cause an additional quote/ledger read. Empty selection hides the already-mounted valuation rather than substituting a zero or claiming an empty ledger; re-selection does not remount.
- Native details/checkboxes provide keyboard interaction, Escape closes and returns focus, outside click closes. No new popup design or modules. Source controls are available in the preserved responsive HTML.

## Reference and comparison
Source project7356929996797649648, screen008f9456b8c643d0b9f41957447b9afc. Preserved HTML SHA25638dff368dfd247372d50da65a57c2bb36d772a76a091f365b29cf7dce65790f9 matches recorded mapping. HTML24–69 contains trigger/count, checkboxes, 全 selection, reset. Responsive HTML replay compared at1280/768/390 CSSpx, DPR2, fixed synthetic data. Before screenshots use b708e33 exact two SFCs loaded by a /tmp-only Vite load plugin; no baseline source copied into the app.

For all3 widths: source trigger225.140625x44, final221.15625x44 (width difference -3.984375px); menu source/final288x209, padding12/radius12; checkbox16x16. No horizontal overflow. The trigger width remains due to text/icon/font metrics; do not claim full visual equality. Actual aliases/masked numbers remain real-field text rather than source dummy tickers. Complete toolbar/content assembly and native original PNG font equality were not accepted by this unit. Native original PNG bytes were not available in these worktrees; source images here are responsive HTML renders, not a claim of native PNG equality.

Evidence: comparison/before-*-closed.png, comparison/source-*-{closed,open}.png, comparison/after-*-{closed,open,dark-open}.png. comparison/geometry.json preserves source geometry; app-final-geometry.json is final app geometry (use it over the earlier after rows in geometry.json). Final app font evidence reports primeicons loaded on all3 widths. fs.allow includes the actual node_modules realpath /workspace/yieldloom-redesign-phase66/node_modules; launcher-only, no production config change.

## Verification
- tests/stitch-summary-scope.browser.mjs:1280/768/390 all/single/two-of-three/empty/all restore; KRW/USD remain independent; missing quote not replaced by stored amount; Escape/focus; explicit refresh removes a selected account and keeps0/2; reset includes only the remaining2; viewer missing calculatedSnapshot remains marked missing. Selection-only API count delta0; URL/localStorage/sessionStorage unchanged; errors0; no writes. Explicit refresh is separately counted and remains read-only. scope-final.log and final/ screenshots.
- tests/stitch-summary-details.browser.mjs: existing3 viewport detail/table tests and12-row desktop/mobile synchronized paging remain passing; new empty-scope/reselect resets page2 to page1 without another read. details-final.log; prior detailed captures in details/.
- npm run type-check passed. Scoped eslint0 errors,1 existing unrelated vue/attributes-order warning. Prettier4 files and git diff --check passed. Logs type-check-final.log/lint-final.log/format.log.
- Full build/CI/real-flow/production validation are parent integration responsibilities, not performed or claimed here.

During evidence setup, a /tmp baseline loader initially returned full SFCs to style queries and was corrected to exact base module IDs; no app defect. One intermediate test expected visible checkbox roles while the source-matching outside-click dismissal had closed the menu; test now opens it explicitly before assertion. Both intermediate attempts were followed by the passing final runs.
