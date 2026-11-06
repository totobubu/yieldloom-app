import { selectAssetOwner } from './portfolio-navigation.mjs';
// Fixed synthetic identities only. UI context changes reuse existing sources and preserve write permissions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output = process.env.STITCH_PRIORITY_STATE_DIR;
const captured = [];
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        if (output) await installStaticAssets(page);
        await installStitchFixtures(page, { admin: true });
        const requests = [],
            errors = [];
        page.on('request', (r) => {
            if (r.url().includes('/api/'))
                requests.push({
                    method: r.method(),
                    path: new URL(r.url()).pathname,
                });
        });
        page.on('pageerror', (e) => errors.push(e.message));
        const ready = async () => {
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
        };
        const capture = async (name, locator) => {
            if (!output) return;
            await fs.mkdir(output, { recursive: true });
            await page.evaluate(() => document.fonts.ready);
            await locator.screenshot({
                path: `${output}/${name}-${width}.png`,
                animations: 'disabled',
            });
            captured.push({
                name,
                width,
                dpr: 2,
                kind: 'component crop at actual viewport',
            });
        };
        await page.goto(base + '/compare?view=similar');
        if (width <= 1024)
            await page.locator('.filter-details > summary').click();
        const reference = page.locator('.similar-reference-card');
        await reference.waitFor();
        await ready();
        const countBefore = await page
            .locator('.comparison-result-count')
            .innerText();
        const refRequests = requests.length;
        await capture('reference-default', reference);
        await page.locator('#comparison-reference').selectOption('DEMO-B');
        assert.match(await reference.innerText(), /DEMO-B/);
        assert.equal(
            await page.locator('.comparison-result-count').innerText(),
            countBefore
        );
        assert.equal(
            requests.length,
            refRequests,
            'Reference context must not fetch or constrain results'
        );
        await reference
            .getByRole('button', { name: '변경', exact: true })
            .click();
        assert.equal(
            await page
                .locator('#comparison-reference')
                .evaluate((el) => el === document.activeElement),
            true
        );
        await capture('reference-changed', reference);
        await page.goto(base + '/mypage?tab=assets');
        const currency = page.locator('.asset-currency-summary');
        await currency.waitFor();
        await page.locator('.accounts li').first().waitFor();
        await ready();
        assert.equal(await page.locator('.accounts li').count(), 3);
        const accountGrid = await page.locator('.accounts').boundingBox();
        const firstAccount = await page
            .locator('.accounts li')
            .first()
            .boundingBox();
        const lastAccount = await page
            .locator('.accounts li')
            .last()
            .boundingBox();
        assert.ok(
            Math.abs(firstAccount.x - accountGrid.x) <= 1,
            `${width}px: account cards must align with the grid's leading edge`
        );
        assert.ok(
            Math.abs(
                lastAccount.x +
                    lastAccount.width -
                    accountGrid.x -
                    accountGrid.width
            ) <= 1,
            `${width}px: account cards must fill the grid's trailing edge`
        );
        if (width === 1280) {
            const accountText = await page
                .locator('.accounts li')
                .allTextContents();
            const beforeResize = requests.length;
            for (const pcWidth of [1024, 1100, 1200, 1280]) {
                await page.setViewportSize({ width: pcWidth, height: 1024 });
                await page.evaluate(() => new Promise(requestAnimationFrame));
                const clippedTools = await page
                    .locator('.account-card-primary-tools button')
                    .evaluateAll((buttons) =>
                        buttons
                            .filter((button) => {
                                const bounds = button.getBoundingClientRect();
                                const card = button
                                    .closest('li')
                                    .getBoundingClientRect();
                                return (
                                    button.scrollWidth >
                                        button.clientWidth + 1 ||
                                    button.scrollHeight >
                                        button.clientHeight + 1 ||
                                    bounds.left < card.left - 1 ||
                                    bounds.right > card.right + 1
                                );
                            })
                            .map((button) => button.textContent.trim())
                    );
                assert.deepEqual(
                    clippedTools,
                    [],
                    `${pcWidth}px: account tools must remain readable`
                );
                assert.deepEqual(
                    await page.locator('.accounts li').allTextContents(),
                    accountText
                );
            }
            assert.equal(
                requests.length,
                beforeResize,
                'account layout changes must reuse loaded data'
            );
        }
        assert.match(
            await currency.locator('[data-currency="USD"] strong').innerText(),
            /\$1,430.00/
        );
        assert.match(
            await page
                .getByRole('combobox', { name: '명의자 선택', exact: true })
                .innerText(),
            /전체 명의자/
        );
        const systemStatus = page.getByRole('region', {
            name: '자산 관리 시스템 상태',
            exact: true,
        });
        await systemStatus.waitFor();
        assert.equal(
            await systemStatus.getByText('미확인', { exact: true }).count(),
            2
        );
        assert.equal(
            await systemStatus.getByText('미집계', { exact: true }).isVisible(),
            true
        );
        assert.doesNotMatch(
            await systemStatus.innerText(),
            /동기화 완료|정상 응답|0건|1분 전/
        );
        const unavailableRetry = systemStatus.getByRole('button', {
            name: '원격 조회 재시도 (미지원)',
            exact: true,
        });
        assert.equal(await unavailableRetry.isDisabled(), true);
        const beforeUnavailableRetry = requests.length;
        await unavailableRetry.evaluate((button) => button.click());
        assert.equal(
            requests.length,
            beforeUnavailableRetry,
            'unavailable diagnostics must not query or mutate data'
        );
        const beforeAlias = requests.length;
        await page
            .locator('.accounts li')
            .first()
            .getByRole('button', { name: '별칭 수정', exact: true })
            .click();
        assert.equal(
            await page
                .locator('#asset-account-alias')
                .evaluate((el) => el === document.activeElement),
            true
        );
        assert.equal(
            requests.length,
            beforeAlias,
            'Alias navigation must not write or refetch'
        );
        await capture('asset-all', currency);
        const allRequests = requests.length;
        await selectAssetOwner(page, '김모음');
        assert.equal(
            await page
                .getByRole('combobox', { name: '명의자 선택', exact: true })
                .innerText(),
            '김모음'
        );
        assert.equal(requests.length, allRequests);
        assert.match(
            await currency.locator('[data-currency="KRW"] strong').innerText(),
            /₩190,000/
        );
        assert.match(
            await currency.locator('[data-currency="USD"] strong').innerText(),
            /\$980.00/
        );
        await capture('asset-own', currency);
        const memberRequests = requests.length;
        await selectAssetOwner(page, '이모음');
        await page.waitForFunction(() =>
            document
                .querySelector(
                    '.asset-currency-summary [data-currency="USD"] strong'
                )
                ?.textContent.includes('$450.00')
        );
        assert.equal(
            (
                await currency
                    .locator('[data-currency="KRW"] strong')
                    .innerText()
            ).trim(),
            '미확인'
        );
        assert.equal(
            requests.length,
            memberRequests,
            'Currency summary must reuse the selected-member projection'
        );
        assert.equal(
            await page
                .locator('.family-page')
                .getByRole('button', { name: '자료 업로드', exact: true })
                .count(),
            0
        );
        assert.match(
            await currency.locator('[data-currency="USD"]').innerText(),
            /추정 평가액 포함/
        );
        assert.equal(
            await page
                .locator('.accounts')
                .getByRole('button', { name: '별칭 수정 불가', exact: true })
                .isDisabled(),
            true
        );
        assert.equal(
            await page
                .locator('.accounts')
                .getByRole('button', {
                    name: '출처 원본 (미지원)',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        assert.equal(
            await page
                .getByRole('button', { name: '별칭 저장', exact: true })
                .count(),
            0,
            'Viewer must not receive alias configuration even if authority metadata names this UID'
        );
        await capture('asset-viewer', currency);
        await selectAssetOwner(page, /^전체 명의자/);
        assert.equal(await page.locator('.accounts li').count(), 3);
        assert.match(
            await currency.locator('[data-currency="USD"] strong').innerText(),
            /\$1,430.00/
        );
        assert.equal(requests.length, memberRequests);
        await capture('asset-all-restored', currency);
        await page.goto(base + '/mypage?tab=insights');
        await page.locator('.insights-summary').waitFor();
        await ready();
        const kpis = page.locator('.insights-summary');
        assert.equal(
            await page
                .locator('.insights-workspace')
                .evaluate(
                    (el) =>
                        getComputedStyle(el).gridTemplateColumns.split(/\s+/)
                            .length
                ),
            width > 1024 ? 2 : 1
        );
        assert.equal(
            await page
                .getByRole('table', {
                    name: '월별 저장 배당 기록',
                    exact: true,
                })
                .locator('tbody tr')
                .count(),
            12
        );
        assert.equal(await kpis.locator('article').count(), 4);
        assert.match(
            await kpis.locator('article').nth(0).innerText(),
            /3\.6\s+USD/
        );
        assert.match(
            await kpis.locator('article').nth(1).innerText(),
            /6\.6\s+USD/
        );
        assert.match(
            await kpis.locator('article').nth(3).innerText(),
            /통화별 독립 보존/
        );
        assert.deepEqual(
            await page
                .locator('.insights-filters label')
                .evaluateAll((labels) => labels.map((el) => el.htmlFor)),
            ['insights-account', 'insights-currency', 'insights-month']
        );
        assert.equal(
            await page
                .locator('.insights-filters')
                .getByRole('button', { name: '분석 다시 조회', exact: true })
                .count(),
            1
        );
        await capture('analysis-filters', page.locator('.insights-filters'));
        await capture('analysis-november', kpis);
        const monthRequests = requests.length;
        await page.locator('#insights-month').fill('2026년 10월');
        await page.keyboard.press('Tab');
        await page.waitForFunction(
            () =>
                document
                    .querySelector('.insights-summary article strong')
                    ?.textContent.trim() === '3 USD'
        );
        assert.match(
            await kpis.locator('article').nth(1).innerText(),
            /3\s+USD/
        );
        assert.equal(
            requests.length,
            monthRequests,
            'Month projection must preserve cached ledger use'
        );
        await capture('analysis-october', kpis);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            'Analysis two-column layout must not overflow'
        );
        await page.goto(base + '/mypage?tab=calendar');
        await page.locator('.calendar-inline-detail article').waitFor();
        await ready();
        const inline = page.locator('.calendar-inline-detail');
        const filterReads = requests.length;
        await page
            .getByRole('group', { name: '배당 통화 필터', exact: true })
            .getByRole('button', { name: 'USD', exact: true })
            .click();
        await page
            .getByRole('group', { name: '배당 일정 날짜 기준', exact: true })
            .getByRole('button', { name: '배당락일', exact: true })
            .click();
        assert.equal(requests.length, filterReads);
        await page
            .getByRole('group', { name: '배당 일정 날짜 기준', exact: true })
            .getByRole('button', { name: '지급일', exact: true })
            .click();
        await page
            .getByRole('group', { name: '배당 통화 필터', exact: true })
            .getByRole('button', { name: '모든 통화', exact: true })
            .click();
        assert.equal(await inline.locator('article').count(), 1);
        await capture('calendar-default', inline);
        if (width > 1024)
            await page
                .getByRole('button', { name: '월간 목록 보기', exact: true })
                .click();
        const rows = page.locator('.event-row');
        const last = rows.last();
        const symbol = await last.locator('.calendar-event-symbol').innerText();
        const calendarRequests = requests.length;
        await last.click();
        await page.getByRole('dialog', { name: /배당 상세/ }).waitFor();
        await page.keyboard.press('Escape');
        await page
            .getByRole('dialog', { name: /배당 상세/ })
            .waitFor({ state: 'hidden' });
        assert.match(
            await inline.innerText(),
            new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        );
        assert.equal(await inline.locator('article').count(), 1);
        assert.equal(
            requests.length,
            calendarRequests,
            'Detail selection must reuse the existing schedule rows'
        );
        await capture('calendar-selected', inline);
        const reconcile = page.getByRole('button', {
            name: '대조 상세 진입',
            exact: true,
        });
        assert.equal(await reconcile.isDisabled(), true);
        await page.locator('.calendar-reconciliation-entry input').check();
        assert.equal(await reconcile.isEnabled(), true);
        await page
            .locator('#dividend-period')
            .fill(width <= 640 ? '2020.01' : '2020년 01월');
        await page.keyboard.press('Tab');
        await page.waitForFunction(
            () =>
                document.querySelectorAll('.calendar-inline-detail article')
                    .length === 0
        );
        assert.equal(
            await reconcile.isDisabled(),
            true,
            'Changing the period must reset the view-only acknowledgement'
        );
        assert.match(await inline.innerText(), /0이라는 뜻은 아닙니다/);
        await capture('calendar-empty', inline);
        await page
            .getByRole('button', {
                name: '오늘 배당 기간 (11.04)',
                exact: true,
            })
            .click();
        assert.equal(
            await page.locator('#dividend-period').inputValue(),
            width <= 640 ? '2026.11' : '2026년 11월'
        );
        await inline.locator('article').waitFor();
        assert.equal(
            requests.length,
            calendarRequests,
            'Period projection must reuse the existing schedule'
        );
        await page.locator('.calendar-reconciliation-entry input').check();
        await reconcile.click();
        await page
            .getByRole('region', { name: '예상 배당과 기록 대조', exact: true })
            .waitFor();
        await ready();
        await capture(
            'calendar-reconciliation',
            page.locator('.reconciliation')
        );
        assert.deepEqual(
            requests.filter((r) => r.method !== 'GET'),
            []
        );
        assert.deepEqual(errors, []);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        console.log(
            `PASS priority/${width}: real ETF reference without filtering/fetching, scoped currencies/unknown/viewer, four unchanged KPIs, inline/modal detail and real reconciliation; no writes`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
if (output)
    await fs.writeFile(
        `${output}/results.json`,
        JSON.stringify(
            { dataset: 'isolated synthetic fixtures only', captured },
            null,
            2
        )
    );
