// Requires local test Flask server :5011 and Vite :5173 proxying to it.
// Authentication is a browser module fixture; API and domain validation run unchanged.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const uid = `browser-${Date.now()}`;
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import { ref, computed } from '/node_modules/.vite/deps/vue.js';
            export const firebaseUser = ref({ uid: '${uid}', email: 'test@example.test', getIdToken: async () => '${uid}' });
            export const authLoading = ref(false), signedIn = computed(() => true);
            export const firebaseReady = false, db = null, auth = null, googleProvider = null;`,
        })
    );
    await page.goto('http://127.0.0.1:5173/mypage');
    await page.getByLabel('내 프로필 이름').fill('홍길동');
    await page.getByLabel('가족 이름', { exact: true }).fill('테스트 가족');
    await page.getByRole('button', { name: '공간 만들기' }).click();
    await page.getByRole('heading', { name: '가족·구성원 관리' }).waitFor();
    await page.getByLabel('명의자').first().selectOption({ label: '홍길동' });
    await page.getByLabel('금융기관', { exact: true }).fill('테스트증권');
    await page.getByLabel('별칭', { exact: true }).fill('장기투자');
    await page.getByLabel('계좌 끝 4자리 (선택)').fill('4321');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 장기투자' }).waitFor();
    assert.match(
        await page.locator('.family-page').innerText(),
        /\*\*\*\*4321/
    );
    await page.getByLabel('자료 종류').selectOption('holdings');
    await page.getByLabel('자료 기준일', { exact: true }).fill('2026-10-15');
    const upload = async () => {
        await page.getByLabel('파일', { exact: true }).setInputFiles({
            name: 'holdings.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(
                'date,symbol,quantity,amount,currency\n2026-10-15,AAPL,bad,500,USD\n'
            ),
        });
        await page.getByLabel(/파일에서 확실히 확인/).check();
        await page.getByRole('button', { name: '추출·미리보기' }).click();
        await page
            .getByRole('heading', { name: /검토 · standard-csv-v1/ })
            .waitFor();
        await page.getByLabel('1행 quantity', { exact: true }).fill('2');
        await page.getByRole('button', { name: '수정 내용 검증·저장' }).click();
    };
    await upload();
    await page.getByText('저장 1행 · 중복 0행', { exact: true }).waitFor();
    await page
        .getByRole('table')
        .filter({
            has: page.getByText('명의자·계좌별 원본 잔고', { exact: true }),
        })
        .getByText('AAPL', { exact: true })
        .waitFor();
    await upload();
    await page.getByText('저장 0행 · 중복 1행', { exact: true }).waitFor();
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await page
        .getByText('확인된 자료 평가액: 500 USD', { exact: true })
        .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: create family/account → upload → correct invalid row → save → replay duplicate → persisted snapshot → mobile layout'
    );
} finally {
    await browser.close();
}
