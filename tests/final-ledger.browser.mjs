import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { projectFinalLedger } from '../lib/final-ledger-view.js';
import {
    finalLedgerFixture,
    finalObservation,
} from './support/final-ledger-fixture.mjs';
const fixture = finalLedgerFixture(
    Array.from({ length: 250 }, (_, i) =>
        finalObservation(i + 100, {
            symbol: i === 249 ? 'LAST' : 'TEST',
            amount: '1.0001',
        })
    )
);
const projected = projectFinalLedger(fixture.observations);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
        }),
        requests = [],
        errors = [];
    let denied = false;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'synthetic',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'synthetic'}),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,auth=null,db=null,googleProvider=null;",
        })
    );
    await page.route('**/api/**', async (r) => {
        const u = new URL(r.request().url());
        requests.push(u);
        assert.equal(r.request().method(), 'GET');
        if (u.searchParams.get('section') !== 'final')
            return r.fulfill({
                status: 404,
                json: { error: 'Unexpected legacy request' },
            });
        if (denied)
            return r.fulfill({
                status: 403,
                json: { error: '합성 접근 거부' },
            });
        const id = u.searchParams.get('observationId');
        return r.fulfill({
            json: {
                schemaVersion: 1,
                section: 'final',
                accountId: 'wife',
                readOnly: true,
                adopted: true,
                comparisonRequired: false,
                releaseId: fixture.checkpoint.gzipSha256,
                snapshotAt: '2025-02-05T00:00:00Z',
                ...(id
                    ? { detail: projected.details.get(id) }
                    : {
                          rows: projected.rows,
                          unassignedRows: projected.unassignedRows,
                      }),
            },
        });
    });
    await page.goto(
        (process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5183') +
            '/admin/sheet-ledger'
    );
    const main = page.locator('main.final-ledger');
    await main
        .getByRole('heading', { name: '토스 거래내역', exact: true })
        .waitFor();
    await main.getByText('255건', { exact: true }).waitFor();
    await page.screenshot({
        path: join(tmpdir(), 'yieldloom-final-ledger-desktop.png'),
        fullPage: false,
    });
    assert.equal(requests.length, 1);
    assert.equal(
        await main.getByText(/승인 대기|시트 매핑|불일치|검토 기준/).count(),
        0
    );
    assert((await main.locator('tbody tr[data-ledger-index]').count()) <= 100);
    await main.getByRole('searchbox', { name: '전체 거래 검색' }).fill('LAST');
    await main.getByRole('cell', { name: 'LAST', exact: true }).waitFor();
    await main.getByRole('searchbox', { name: '전체 거래 검색' }).fill('QDTE');
    assert.equal(await main.locator('tbody tr[data-ledger-index]').count(), 2);
    assert.equal(await main.getByText('7.2500', { exact: true }).count(), 1);
    await main.getByRole('button', { name: /수량/ }).click();
    assert.equal(requests.length, 1);
    await main
        .getByRole('button', { name: /QDTE .* 출처/ })
        .first()
        .click();
    const dialog = page.getByRole('dialog', { name: '거래 출처' });
    await dialog.getByText('토스 주문 · 아내').waitFor();
    assert.equal(requests.length, 2);
    assert.equal(
        await dialog.getByText('providerOrderId', { exact: true }).count(),
        0
    );
    await page.keyboard.press('Escape');
    await main
        .getByRole('button', { name: /QDTE .* 출처/ })
        .first()
        .click();
    await page
        .getByRole('dialog', { name: '거래 출처' })
        .getByText('토스 주문 · 아내')
        .waitFor();
    assert.equal(requests.length, 2);
    await page.keyboard.press('Escape');
    await main.getByRole('searchbox', { name: '전체 거래 검색' }).fill('');
    await main
        .getByRole('combobox', { name: '거래 유형', exact: true })
        .click();
    await page
        .getByRole('option', { name: '미체결 취소', exact: true })
        .click();
    await main.getByText('1건', { exact: true }).waitFor();
    assert.equal(await main.locator('.summary article').count(), 1);
    await main.getByRole('combobox', { name: '계좌', exact: true }).click();
    await page
        .getByRole('option', { name: '계좌 미지정 명세서', exact: true })
        .click();
    await main.getByRole('cell', { name: '세금환급', exact: true }).waitFor();
    assert.equal(
        await main
            .locator('.summary strong')
            .filter({ hasText: '0.2500' })
            .count(),
        1
    );
    assert(
        (
            await main
                .locator('tbody tr[data-ledger-index] td')
                .nth(5)
                .innerText()
        ).includes('0.2500')
    );
    assert.equal(requests.length, 2);
    await page.getByRole('listbox').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
    }));
    assert(dimensions.scroll <= dimensions.width);
    await page.screenshot({
        path: join(tmpdir(), 'yieldloom-final-ledger-mobile.png'),
        fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await page.waitForFunction(() => {
        const luminance = (text) => {
            const rgb = text
                .match(/[0-9.]+/g)
                .slice(0, 3)
                .map(Number)
                .map((n) => {
                    const v = n / 255;
                    return v <= 0.04045
                        ? v / 12.92
                        : ((v + 0.055) / 1.055) ** 2.4;
                });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        return ['.filters .p-select', '.filters .p-inputtext'].every(
            (selector) => {
                const el = document.querySelector(selector),
                    label = el.querySelector('.p-select-label') || el;
                const a = luminance(getComputedStyle(el).backgroundColor),
                    b = luminance(getComputedStyle(label).color);
                return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5;
            }
        );
    });
    await page.screenshot({
        path: join(tmpdir(), 'yieldloom-final-ledger-dark.png'),
        fullPage: true,
    });
    await page.evaluate(() =>
        document.documentElement.classList.remove('p-dark')
    );
    await main.getByRole('combobox', { name: '계좌', exact: true }).click();
    await page.getByRole('option', { name: '아내', exact: true }).click();
    denied = true;
    await main.getByRole('button', { name: '새로고침', exact: true }).click();
    await main.getByText('합성 접근 거부').waitFor();
    assert.equal(await main.locator('tbody tr[data-ledger-index]').count(), 0);
    assert.equal(await main.locator('.summary').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'Final ledger: adopted view, no comparison requests, source roles/decimal totals, filters, separate PDF scope, lazy details/cache, missing values, permission purge and desktop/mobile/dark verified.'
    );
} finally {
    await browser.close();
}
