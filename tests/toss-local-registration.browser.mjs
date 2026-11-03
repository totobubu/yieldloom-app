import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createCompanionHttp } from '../scripts/toss/local-companion.mjs';
const calls = [],
    code = 'S'.repeat(43);
const companion = {
    pairing: code,
    paired: (v) => v === code,
    act: async (path, input) => {
        calls.push({ path, input });
        if (path === '/flow-info')
            return {
                label: '합성 계좌',
                accountId: 'synthetic42',
                suffix: '0042',
            };
        if (path === '/unlock') return { unlocked: true };
        if (path === '/enroll') return { registered: true };
        if (path === '/lock') return { locked: true };
        throw Error('unexpected request');
    },
};
const server = createCompanionHttp(companion);
await new Promise((r) => server.listen(43129, '127.0.0.1', r));
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
        }),
        external = [],
        errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
            external.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    await page.goto('http://127.0.0.1:43129/register?flow=synthetic');
    await page.getByText(code, { exact: true }).waitFor();
    await page
        .getByLabel('저장소 암호', { exact: false })
        .fill('SYNTHETIC-local-passphrase');
    await page
        .getByRole('button', { name: '저장소 열기 / 처음 만들기' })
        .click();
    await page.getByText('합성 계좌 · 끝 0042', { exact: false }).waitFor();
    assert.equal(
        await page.getByLabel('저장소 암호', { exact: false }).inputValue(),
        ''
    );
    await page
        .getByLabel('전체 토스 계좌번호', { exact: false })
        .fill('00000000042');
    await page
        .getByLabel('토스 client_id', { exact: true })
        .fill('SYNTHETIC-client-id');
    await page
        .getByLabel('토스 client_secret', { exact: true })
        .fill('SYNTHETIC-secret');
    await page
        .getByRole('checkbox', { name: '선택한 본인 계좌', exact: false })
        .check();
    await page.getByRole('button', { name: '이 PC에 등록' }).focus();
    await page.keyboard.press('Enter');
    await page
        .getByRole('status')
        .filter({ hasText: '암호화해 등록했습니다' })
        .waitFor();
    assert.equal(
        calls.find((r) => r.path === '/enroll').input.form.replaceExisting,
        false
    );
    assert.equal(
        await page
            .getByLabel('토스 client_secret', { exact: true })
            .inputValue(),
        ''
    );
    await page.getByRole('button', { name: '저장소 잠그기' }).click();
    await page
        .getByRole('status')
        .filter({ hasText: '저장소를 잠갔습니다' })
        .waitFor();
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
    }
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0
    );
    console.log(
        'PASS: local registration target/unlock/consent/enroll/clear/lock/keyboard/mobile; external requests/storage: 0'
    );
} finally {
    await browser.close();
    await new Promise((r) => server.close(r));
}
