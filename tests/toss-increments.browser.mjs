import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { projectFinalLedger } from '../lib/final-ledger-view.js';
import {
    overlayIncrements,
    incrementHash,
} from '../lib/toss-ledger-increments.js';
import { finalLedgerFixture } from './support/final-ledger-fixture.mjs';
const f = finalLedgerFixture(),
    baseline = projectFinalLedger(f.observations);
const id = incrementHash('synthetic-ui-dividend');
const d = {
    observationId: id,
    currency: 'USD',
    symbol: 'TESTDIV',
    displayedPaidAt: '2025-02-06 13:23',
    gross: '12.3456',
    tax: '1.2345',
    net: '11.1111',
    sourceIdentity: { sourceSha256: incrementHash('synthetic-ui-source') },
    coverage: 'synthetic today-only detail, provider ID unavailable',
};
const projected = overlayIncrements(baseline, {
    verified: [{ observations: [d], apiOrders: [] }],
    revision: incrementHash('synthetic-index'),
    entryCount: 1,
});
const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    let denied = false;
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'synthetic',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'synthetic'}),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,auth=null,db=null,googleProvider=null;",
        })
    );
    await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        if (denied)
            return r.fulfill({
                status: 403,
                json: { error: '합성 권한 거부' },
            });
        const observationId = u.searchParams.get('observationId');
        return r.fulfill({
            json: {
                schemaVersion: 1,
                section: 'final',
                accountId: 'wife',
                readOnly: true,
                adopted: true,
                comparisonRequired: false,
                releaseId: f.checkpoint.gzipSha256,
                snapshotAt: '2025-02-05T00:00:00Z',
                incrementEntryCount: 1,
                incrementRowCount: 1,
                ...(observationId
                    ? { detail: projected.details.get(observationId) }
                    : {
                          rows: projected.rows,
                          unassignedRows: projected.unassignedRows,
                      }),
            },
        });
    });
    await page.goto(
        (process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5173') +
            '/admin/sheet-ledger'
    );
    const main = page.locator('main.final-ledger');
    await main
        .getByRole('searchbox', { name: '전체 거래 검색' })
        .fill('TESTDIV');
    await main.getByRole('cell', { name: 'TESTDIV 토스 웹 입금' }).waitFor();
    assert.equal(await main.locator('tbody tr[data-ledger-index]').count(), 1);
    await main.getByRole('button', { name: 'TESTDIV 2025-02-06 출처' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('12.3456 USD', { exact: true }).waitFor();
    await dialog.getByText('1.2345 USD', { exact: true }).waitFor();
    await dialog.getByText('11.1111 USD', { exact: true }).waitFor();
    await dialog
        .getByText('2025-02-06 13:23 KST · minute', { exact: true })
        .waitFor();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await main.isVisible());
    denied = true;
    await main.getByRole('button', { name: '새로고침' }).click();
    await main.getByText('합성 권한 거부', { exact: true }).waitFor();
    assert.equal(await main.locator('tbody tr[data-ledger-index]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'Synthetic browser: incremental web source, single row, exact gross/tax/net/time, mobile, denied refresh passed.'
    );
} finally {
    await browser.close();
}
