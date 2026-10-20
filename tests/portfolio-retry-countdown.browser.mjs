import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'retry-fixture',email:'fixture@example.test',getIdToken:async()=> 'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,db=null,auth=null,googleProvider=null;`,
        })
    );
    let calls = 0,
        unavailable = false;
    await page.route('**/api/family-portfolio*', (route) => {
        calls++;
        if (unavailable)
            return route.fulfill({
                status: 503,
                json: { error: '검증용 일시 오류' },
            });
        if (calls <= 2)
            return route.fulfill({
                status: 429,
                headers: { 'Retry-After': calls === 1 ? '60' : '120' },
                json: {
                    code: 'DATA_RESOURCE_EXHAUSTED',
                    error: '데이터베이스 요청이 제한되었습니다. 기존 계좌와 거래내역은 유지됩니다.',
                    retryTiming: 'recommended',
                    limitType: 'unknown',
                },
            });
        return route.fulfill({ json: { families: [] } });
    });
    await page.goto(
        (process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5173') + '/mypage'
    );
    await page
        .getByText(
            '현재 응답만으로는 하루 사용량 소진 여부와 실제 제한 해제 시각을 확인할 수 없습니다.',
            { exact: true }
        )
        .waitFor();
    const retry = page.getByRole('button', { name: /초 후 다시 시도/ });
    assert.equal(await retry.isDisabled(), true);
    assert.equal(
        await page
            .getByRole('button', { name: '새로고침', exact: true })
            .isDisabled(),
        true
    );
    assert.equal(calls, 1);
    await page.screenshot({
        path: '/tmp/yieldloom-retry-countdown-mobile.png',
        fullPage: true,
    });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await page.clock.runFor(61000);
    await page
        .getByText(
            '권장 대기 시간이 지났습니다. 계좌 목록을 다시 조회할 수 있습니다.',
            { exact: true }
        )
        .waitFor();
    assert.equal(calls, 1); // No automatic retry storm when the timer expires.
    await page
        .getByRole('button', { name: '계좌 목록 다시 시도', exact: true })
        .click();
    await page
        .getByRole('button', { name: '120초 후 다시 시도', exact: true })
        .waitFor();
    assert.equal(calls, 2);
    await page.clock.runFor(121000);
    await page
        .getByRole('button', { name: '계좌 목록 다시 시도', exact: true })
        .click();
    await page.getByLabel('금융기관', { exact: true }).waitFor();
    assert.equal(calls, 3);
    assert.equal(
        await page
            .getByText('권장 대기 시간이 지났습니다.', { exact: false })
            .count(),
        0
    );
    unavailable = true;
    await page.reload();
    await page.getByText('검증용 일시 오류', { exact: true }).waitFor();
    assert.equal(
        await page
            .getByRole('button', { name: '계좌 목록 다시 시도', exact: true })
            .isEnabled(),
        true
    );
    assert.equal(
        await page.getByText('권장 재시도 대기:', { exact: false }).count(),
        0
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: 60s countdown, request suppression, expiry, renewed 120s limit, manual recovery, non-429 error and mobile layout'
    );
} finally {
    await browser.close();
}
