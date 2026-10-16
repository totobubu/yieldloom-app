// Requires local in-memory Flask server :5011 and Vite proxying to it.
// The auth module is a fixture. No real accounts or uploaded personal data are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5175';
const output = 'design-review/primevue-implementation';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const uid = `browser-${Date.now()}`;
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import { ref, computed } from '/node_modules/.vite/deps/vue.js';
        export const firebaseUser = ref({ uid: '${uid}', displayName: '홍길동', email: 'test@example.test', getIdToken: async () => '${uid}' });
        export const authLoading = ref(false), signedIn = computed(() => true);
        export const firebaseReady = false, db = null, auth = null, googleProvider = null;`,
        })
    );
    await page.route('**/api/portfolio-capital*', (route) =>
        route.fulfill({
            json: { entries: [], classifications: [], allocations: [] },
        })
    );
    const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
    const select = async (name, option) => {
        await page.getByRole('combobox', { name, exact: true }).click();
        await page.getByRole('option', { name: option, exact: true }).click();
    };
    await page.goto(base + '/mypage');
    await page
        .getByRole('heading', { name: '내 포트폴리오', exact: true })
        .waitFor();
    await page
        .getByRole('button', { name: '첫 계좌 등록', exact: true })
        .click();
    await page.getByLabel('금융기관', { exact: true }).fill('테스트증권');
    await page.getByLabel('별칭', { exact: true }).fill('장기투자');
    await page.getByLabel('계좌 끝 4자리 (선택)').fill('4321');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 장기투자' }).waitFor();
    assert.match(
        await page.locator('.family-page').innerText(),
        /\*\*\*\*4321/
    );
    const upload = async () => {
        await tab('자료 업로드');
        await select('자료 종류', '잔고내역');
        await page
            .getByLabel('자료 기준일', { exact: true })
            .fill('2026-10-15');
        await page
            .getByLabel('파일', { exact: true })
            .setInputFiles({
                name: 'holdings.csv',
                mimeType: 'text/csv',
                buffer: Buffer.from(
                    'date,symbol,quantity,amount,currency\n2026-10-15,AAPL,bad,500,USD\n'
                ),
            });
        await page.getByLabel(/파일에서 확실히 확인/).check();
        await page
            .getByRole('button', { name: '추출·미리보기', exact: true })
            .click();
        await page
            .getByRole('heading', { name: /검토 · standard-csv-v1/ })
            .waitFor();
        await page.getByLabel('1행 quantity', { exact: true }).fill('2');
        await page
            .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
            .click();
    };
    await upload();
    await page.getByText('저장 1행 · 중복 0행', { exact: true }).waitFor();
    await tab('한눈에 보기');
    await page
        .getByRole('table', { name: '명의자·계좌별 원본 잔고', exact: true })
        .getByText('AAPL', { exact: true })
        .waitFor();
    await upload();
    await page.getByText('저장 0행 · 중복 1행', { exact: true }).waitFor();
    await tab('한눈에 보기');
    await page
        .getByText('확인된 자료 평가액: 500 USD', { exact: true })
        .waitFor();
    await tab('가족 관리');
    await page.getByLabel('자녀 이름', { exact: true }).fill('자녀');
    await page.getByLabel('법정 보호자로 관리할 권한이 있습니다').check();
    await page
        .getByRole('button', { name: '미성년 프로필 추가', exact: true })
        .click();
    await page
        .getByText('자녀 · 미성년 · 보호자 관리', { exact: false })
        .waitFor();
    await page
        .getByRole('button', { name: '가족 포트폴리오', exact: true })
        .click();
    await tab('계좌 관리');
    await select('명의자', '자녀');
    await page.getByLabel('별칭', { exact: true }).fill('자녀 계좌');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 자녀 계좌' }).waitFor();
    await upload();
    await page.getByText('저장 1행 · 중복 0행', { exact: true }).waitFor();
    await tab('한눈에 보기');
    await page
        .getByText('확인된 자료 평가액: 1,000 USD', { exact: true })
        .waitFor();
    await page.getByRole('button', { name: '내 계좌', exact: true }).click();
    await page
        .getByText('확인된 자료 평가액: 500 USD', { exact: true })
        .waitFor();
    await page.reload();
    await page
        .getByText('확인된 자료 평가액: 500 USD', { exact: true })
        .waitFor();
    const layouts = [];
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const name of [
            '한눈에 보기',
            '계좌 관리',
            '자료 업로드',
            '가족 관리',
        ]) {
            await tab(name);
            const scrollWidth = await page.evaluate(
                () => document.documentElement.scrollWidth
            );
            assert.ok(
                scrollWidth <= width + 1,
                `${width}/${name} overflow ${scrollWidth}`
            );
            layouts.push({ width, tab: name, scrollWidth });
            await page.screenshot({
                animations: 'disabled',
                path: `${output}/${width}-portfolio-${{ '한눈에 보기': 'overview', '계좌 관리': 'accounts', '자료 업로드': 'upload', '가족 관리': 'family' }[name]}.png`,
            });
        }
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
        `${output}/portfolio-results.json`,
        JSON.stringify(
            {
                layouts,
                errors,
                flow: 'register → CSV preview → repair invalid quantity → save → duplicate detection → family account → personal-only totals',
            },
            null,
            2
        )
    );
    console.log(
        'PASS: PrimeVue portfolio tabs, account registration, CSV review/repair/save, duplicates, family scopes, persisted snapshot, 16 responsive layouts'
    );
} finally {
    await browser.close();
}
