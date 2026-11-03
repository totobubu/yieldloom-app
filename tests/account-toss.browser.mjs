// Synthetic, loopback-only Vite harness; never contacts Firebase/Toss/R2.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    const errors = [],
        external = [],
        requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
            external.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    page.on('request', (req) => {
        if (req.url().includes('/__dev/toss-connection'))
            requests.push(
                req.method() === 'POST' ? req.postDataJSON().action : 'status'
            );
    });
    await page.goto('http://127.0.0.1:5173/tests/toss-connection-demo.html');
    const summary = page.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await page
        .getByText('개발 전용 모의 데이터입니다.', { exact: false })
        .waitFor();
    assert.equal(requests.filter((a) => a === 'status').length, 1);
    await page.getByRole('button', { name: '연결 등록', exact: true }).click();
    await page
        .getByRole('button', { name: '계좌 연결 확인', exact: true })
        .click();
    await page
        .getByRole('button', { name: '선택 계좌 조회', exact: true })
        .click();
    await page.getByText('DEMO · 1주', { exact: true }).waitFor();
    assert.deepEqual(requests.slice(0, 4), [
        'status',
        'register',
        'verify',
        'query',
    ]);
    let release, entered;
    const pending = new Promise((r) => {
        entered = r;
    });
    const gate = new Promise((r) => {
        release = r;
    });
    await page.route('**/__dev/toss-connection', async (route) => {
        if (route.request().postDataJSON()?.action !== 'query')
            return route.continue();
        const response = await route.fetch();
        entered();
        await gate;
        await route.fulfill({ response }).catch(() => {});
    });
    // Late result from wife cannot fill husband's panel; repeated click is disabled.
    await page
        .getByRole('button', { name: '선택 계좌 조회', exact: true })
        .click();
    await pending;
    assert.equal(
        await page
            .getByRole('button', { name: '선택 계좌 조회', exact: true })
            .isDisabled(),
        true
    );
    await page
        .getByRole('combobox', { name: '모의 계좌' })
        .selectOption('husband');
    release();
    await page
        .getByRole('button', { name: '연결 등록', exact: true })
        .waitFor();
    assert.equal(
        await page.getByText('DEMO · 1주', { exact: true }).count(),
        0
    );
    await page.unroute('**/__dev/toss-connection');
    await page.getByRole('button', { name: '연결 등록', exact: true }).click();
    await page
        .getByRole('button', { name: '계좌 연결 확인', exact: true })
        .click();
    await page
        .getByRole('button', { name: '선택 계좌 조회', exact: true })
        .click();
    await page.getByText('DEMO · 2주', { exact: true }).waitFor();
    await page
        .getByRole('checkbox', { name: '선택 계좌의 연결 해제를 확인합니다.' })
        .check();
    await page.getByRole('button', { name: '연결 해제', exact: true }).click();
    await page.getByText('연결 해제됨', { exact: true }).waitFor();
    assert.equal(
        await page
            .getByRole('button', { name: '선택 계좌 조회', exact: true })
            .count(),
        0
    );
    await page.route('**/__dev/toss-connection?*', (route) => route.abort());
    await page.getByRole('button', { name: '연결 상태 다시 확인' }).click();
    await page
        .getByText('연결 요청을 완료하지 못했습니다.', { exact: false })
        .waitFor();
    await page.unroute('**/__dev/toss-connection?*');
    await page.getByRole('button', { name: '연결 상태 다시 확인' }).click();
    await page.getByText('연결 해제됨', { exact: true }).waitFor();
    const overflow = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth,
        nested: [...document.querySelectorAll('main *')].filter(
            (e) =>
                ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) &&
                e.scrollHeight > e.clientHeight + 2
        ).length,
    }));
    assert.deepEqual(overflow, { horizontal: false, nested: 0 });
    await page.evaluate(() =>
        Promise.all(
            document.getAnimations().map((a) => a.finished.catch(() => {}))
        )
    );
    await page.screenshot({
        path: '/tmp/account-toss-mobile.png',
        fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
        path: '/tmp/account-toss-desktop-dark.png',
        fullPage: true,
    });
    await summary.click();
    await summary.click();
    await page.getByText('연결 해제됨', { exact: true }).waitFor();
    await page.goto('about:blank');
    await page.goBack();
    await page.locator('summary').waitFor();
    assert.equal(
        await page.getByText('DEMO · 1주', { exact: true }).count(),
        0
    );
    assert.equal(
        await page.getByText('DEMO · 2주', { exact: true }).count(),
        0
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.deepEqual(
        await page.evaluate(() => ({
            local: localStorage.length,
            session: sessionStorage.length,
        })),
        { local: 0, session: 0 }
    );
    console.log(
        'PASS mock end-to-end, keyboard/mobile/dark, late result isolation, duplicate guard, disconnect, error/retry and reopen. No external requests or browser storage.'
    );
    console.log(
        JSON.stringify({
            browserRequests: requests.length,
            firestore: 0,
            financialProvider: 0,
            initialRequests: requests.slice(0, 4),
        })
    );
} finally {
    await browser.close();
}
