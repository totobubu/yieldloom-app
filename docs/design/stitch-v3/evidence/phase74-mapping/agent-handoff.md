# Phase 74: mandatory mapping confirmation

Base: 7b8f4bad9af7125fbe252b586a1caa59f74795bb. Local branch fix/stitch-import-control-phase74.

This is an approved UX change replacing the deliberate PHASE33 manual-mapping exception. Manual and restored settings now both require the existing mapping/default-currency confirmation before preview. It is neither server authorization nor final save approval. No financial definition, endpoint, FormData contract, permission, parent canEdit gate, file validation or final save path changes. Broker has no separate readonly mode; existing parent edit gating remains unchanged.

Authoritative project 17382728461495959991 mapping references: PC 9ae2f0f1253a41b1839e792d36996900 (HTML 597), Tablet 0bb2ab1d8197472f910b73ed175c4448 (HTML 569), Mobile e0fb1368a1684edaa56c1a506e806530 (HTML 564). These show the required confirmation and blocked missing-type state. Original bytes and hashes verified in reference-integrity.json. The manual-ready unchecked state is a synthetic functional extension of that explicit requirement; no native frame for this state is invented.

Implementation guards both CTA/native required validation and preview handler; busy/in-flight direct submit returns. Synchronous mapping/currency/scope invalidation prevents same-tick reuse of stale confirmation. Existing preset-specific wording is retained. Existing manual integration tests check the confirmation at tests/broker-spreadsheet.browser.mjs:228 (holdings) and :317 (transaction CSV); existing financial assertions unchanged. capture-broker-mapping now checks manual unchecked blocked and checks before preview; all existing font/error assertions remain strict.

PASS: dedicated tests/broker-confirmation.browser.mjs at 1280/834/390. Enter, Space, native requestSubmit, direct submit, busy guard, same-tick currency/mapping mutations, preset reload, missing/duplicate fields, XLSX worksheet/header/encoding changes, broker/file/account/kind resets. Same actual FormData fields/mapping/file metadata after permitted preview. Per viewport exactly 9 explicitly invoked synthetic inspectSpreadsheet POST requests; UI confirmation adds 0 API calls; 3 preview emits captured locally, no live storage. JS errors 0. Baseline all 3 widths records deliberate old unchecked-ready CTA enabled; after all disabled, screenshots and results in before/ and after/.

PASS: vue-tsc --noEmit; changed-files ESLint; changed-files Prettier check; git diff --check.

LIMIT: actual broker integration Memory API suite and full build delegated to root integration/CI. No actual account/customer PDF tested or uploaded. Native PNG exact match is not accepted. Original font declaration versus native raster font remains outside this functional change. Existing strict source capture currently reports PrimeIcons font net::ERR_ABORTED in symlink dependencies; diagnostic copy only allows these failures to be recorded for all viewports, not accepted. Production verification/remote CI/deployment are root-only and have not been run by this child.

Run dedicated suite: UI_BASE_URL=http://127.0.0.1:5175 CHROMIUM_PATH=/usr/bin/chromium node tests/broker-confirmation.browser.mjs

Strict source capture is pending root port 5234 integration with explicit worktree/dependency fs.allow. Diagnostic all-four-width measurements are evidence only; font failures are retained in measurements.json and cannot constitute visual acceptance. No permanent assertions were relaxed. Child will stop source writes after local commit.
