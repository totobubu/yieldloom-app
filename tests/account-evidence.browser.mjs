import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
        }),
        errors = [],
        external = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
            external.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    await page.goto(
        'http://127.0.0.1:5173/tests/toss-account-evidence-demo.html'
    );
    await page
        .getByLabel('로컬 프로그램 연결 코드', { exact: true })
        .fill('S'.repeat(43));
    await page.getByRole('button', { name: '로컬 등록 페이지 준비' }).click();
    assert.match(
        await page
            .getByRole('link', {
                name: '이 PC에서 선택 계좌 API 등록 페이지 열기',
            })
            .getAttribute('href'),
        /^http:\/\/127\.0\.0\.1:43129/
    );
    await page
        .getByRole('checkbox', { name: '로컬 등록을 마쳤으며', exact: false })
        .check();
    await page.getByRole('button', { name: '등록 완료 확인·저장' }).click();
    await page.getByRole('button', { name: '로컬 연결 확인' }).click();
    const issue = page.getByRole('button', { name: '토큰 발급·재발급' });
    assert.equal(await issue.isDisabled(), true);
    await page
        .getByRole('checkbox', { name: '새 토큰 발급 시', exact: false })
        .check();
    await issue.click();
    await page.getByLabel('주문 조회 시작일').fill('2026-01-01');
    await page.getByLabel('주문 조회 종료일').fill('2026-01-03');
    await page.getByRole('button', { name: '선택 계좌 로컬 업데이트' }).click();
    await page
        .getByText('API 주문 관측 2건의 계좌별 저장을 확인했습니다.', {
            exact: false,
        })
        .waitFor();
    await page
        .getByText('선택 계좌 자료 출처·원금 계산 근거', { exact: true })
        .click();
    await page
        .getByText('전체 남은 원금은 미확정입니다.', { exact: false })
        .waitFor();
    await page
        .getByText('배당 30 / 원금 50 / 미확인 0', { exact: false })
        .waitFor();
    await page.getByRole('button', { name: '계좌 API 관측 읽기' }).click();
    const mutations = [];
    await page.route('**/api/portfolio-capital*', (route) => {
        mutations.push(route.request().postDataJSON());
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{}',
        });
    });
    await page.getByRole('button', { name: '미확인 나머지 검토·선택' }).click();
    await page
        .getByText(
            '추적한 배당·원금 후보와 미확인 나머지를 검토용으로 채웠습니다.',
            { exact: false }
        )
        .waitFor();
    assert.equal(mutations.length, 0);
    await page
        .getByRole('button', {
            name: '미확인 나머지만 원금으로 선택',
            exact: true,
        })
        .click();
    assert.equal(mutations.length, 0);
    await page.getByRole('button', { name: '배분 확정', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].id, 'W2');
    assert.deepEqual(mutations[0].withdrawalParts, {
        principal: 2000,
        dividend: 0,
        profit: 0,
        unknown: 0,
    });
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const dark of [false, true]) {
            await page.evaluate(
                (v) => document.documentElement.classList.toggle('p-dark', v),
                dark
            );
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth
                ),
                false
            );
        }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0
    );
    console.log(
        'PASS: account setup/explicit token confirmation/update/provenance/principal policy/mobile/desktop/light/dark; external requests/storage: 0'
    );
} finally {
    await browser.close();
}
