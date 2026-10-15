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
    await page.goto('http://127.0.0.1:5173/mypage');
    await page
        .getByRole('heading', { name: '내 포트폴리오', exact: true })
        .waitFor();
    assert.equal(
        await page
            .getByRole('heading', { name: '가족 공간 만들기 / 참여' })
            .isVisible(),
        false
    );
    await page
        .getByRole('heading', { name: '내 계좌 등록', exact: true })
        .waitFor();
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
    await page.getByText('가족 추가·관리 (선택)', { exact: true }).click();
    await page.getByLabel('자녀 이름', { exact: true }).fill('자녀');
    await page.getByLabel('법정 보호자로 관리할 권한이 있습니다').check();
    await page.getByRole('button', { name: '미성년 프로필 추가' }).click();
    await page
        .getByText('자녀 · 미성년 · 보호자 관리', { exact: false })
        .waitFor();
    await page
        .getByRole('button', { name: '가족 포트폴리오', exact: true })
        .click();
    await page.getByLabel('명의자').first().selectOption({ label: '자녀' });
    await page.getByLabel('별칭', { exact: true }).fill('자녀 계좌');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 자녀 계좌' }).waitFor();
    await upload();
    await page
        .getByText('확인된 자료 평가액: 1,000 USD', { exact: true })
        .waitFor();
    await page.getByRole('button', { name: '내 계좌', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 장기투자' }).waitFor();
    await page
        .getByText('확인된 자료 평가액: 500 USD', { exact: true })
        .waitFor();
    assert.equal(
        await page.getByRole('button', { name: /자녀 계좌/ }).count(),
        0
    );
    await page.reload();
    await page.getByRole('heading', { name: '선택 계좌: 장기투자' }).waitFor();
    assert.equal(
        await page
            .getByRole('heading', { name: '가족 공간 만들기 / 참여' })
            .isVisible(),
        false
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: personal account without family setup → optional family accounts → personal-only totals → upload → correct invalid row → save → replay duplicate → persisted snapshot → mobile layout'
    );
} finally {
    await browser.close();
}
