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
    const downloadCsv = async (targetPage = page) => {
        const pending = targetPage.waitForEvent('download');
        await targetPage
            .getByRole('button', { name: 'CSV 다운로드', exact: true })
            .click();
        const file = await pending;
        const chunks = [];
        for await (const chunk of await file.createReadStream())
            chunks.push(chunk);
        return Buffer.concat(chunks).toString('utf8');
    };
    await page.goto(base + '/mypage');
    await page
        .getByRole('heading', { name: '내 포트폴리오', exact: true })
        .waitFor();
    await page.getByLabel('금융기관', { exact: true }).waitFor();
    await page.getByLabel('금융기관', { exact: true }).fill('테스트증권');
    await page.getByLabel('별칭', { exact: true }).fill('장기투자');
    await page.getByLabel('계좌 끝 4자리 (선택)').fill('4321');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 장기투자' }).waitFor();
    assert.match(
        await page.locator('.family-page').innerText(),
        /\*\*\*\*4321/
    );
    const upload = async ({ date = '2026-10-15', amount = 500 } = {}) => {
        await tab('자료 업로드');
        const another = page.getByRole('button', {
            name: '추가 등록',
            exact: true,
        });
        if (await another.isVisible()) await another.click();
        await select('자료 종류', '잔고내역');
        await page.getByLabel('잔고 기준일', { exact: true }).fill(date);
        await page.getByLabel('파일', { exact: true }).setInputFiles({
            name: 'holdings.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(
                `date,symbol,quantity,amount,currency\n${date},AAPL,bad,${amount},USD\n`
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
    await page
        .getByRole('heading', {
            name: '자료 저장이 완료되었습니다',
            exact: true,
        })
        .waitFor();
    await page
        .getByRole('button', { name: 'CSV로 내려받기', exact: true })
        .click();
    const holdingsCsv = await downloadCsv();
    assert.ok(holdingsCsv.startsWith('\uFEFFdate,'));
    assert.match(holdingsCsv, /"AAPL","2","500","USD"/);
    assert.match(holdingsCsv, /"2026-10-15","standard-csv-v1",""/);
    assert.ok(!holdingsCsv.includes('4321'));
    await select('내보낼 자료', '저장된 전체 거래');
    await page
        .getByRole('button', { name: 'CSV 다운로드', exact: true })
        .click();
    await page
        .getByText('내보낼 저장 자료가 없습니다.', { exact: true })
        .waitFor();
    await page.keyboard.press('Escape');
    await page
        .getByRole('dialog', { name: 'CSV 내보내기', exact: true })
        .waitFor({ state: 'hidden' });
    await tab('한눈에 보기');
    await tab('보유 종목');
    await page.waitForURL('**/mypage?tab=overview&view=holdings');
    await page
        .getByRole('table', { name: '명의자·계좌별 잔고', exact: true })
        .getByText('AAPL', { exact: true })
        .waitFor();
    await upload();
    await page.getByText('저장 0행 · 중복 1행', { exact: true }).waitFor();
    await page
        .getByRole('heading', { name: '이미 등록된 자료입니다', exact: true })
        .waitFor();
    await upload({ date: '2026-10-14', amount: 400 });
    await page.getByText(/과거 기준일 자료로 보관했습니다/).waitFor();
    await tab('한눈에 보기');
    await page
        .getByText('확인된 자료 평가액: 500 USD', { exact: true })
        .waitFor();

    // Seed 201 real, validated entries through the in-memory Flask API. The
    // export must fetch the second page rather than just the displayed rows.
    const headers = { Authorization: `Bearer ${uid}` };
    const apiGet = async (query) => {
        const response = await page.request.get(
            `${base}/api/family-portfolio?${new URLSearchParams(query)}`,
            { headers }
        );
        assert.equal(response.status(), 200);
        return response.json();
    };
    const apiPost = async (action, data, token = uid) => {
        const response = await page.request.post(
            `${base}/api/family-portfolio?action=${action}`,
            { headers: { Authorization: `Bearer ${token}` }, data }
        );
        assert.equal(response.status(), 200);
        return response.json();
    };
    const familyId = (await apiGet({})).families[0].id;
    const account = (await apiGet({ familyId })).accounts.find(
        (a) => a.alias === '장기투자'
    );
    for (const [start, count] of [
        [0, 200],
        [200, 1],
    ]) {
        const content =
            'date,symbol,quantity,amount,currency,type,externalId\n' +
            Array.from(
                { length: count },
                (_, index) =>
                    `2026-10-15,AAPL,0.5,10,USD,buy,export-trade-${start + index}`
            ).join('\n');
        const response = await page.request.post(
            `${base}/api/family-portfolio?action=preview`,
            {
                headers,
                multipart: {
                    accountId: account.id,
                    ownerId: account.ownerId,
                    institution: account.institution,
                    kind: 'transactions',
                    asOf: '2026-10-15',
                    identityConfirmed: 'true',
                    file: {
                        name: 'transactions.csv',
                        mimeType: 'text/csv',
                        buffer: Buffer.from(content),
                    },
                },
            }
        );
        assert.equal(response.status(), 200);
        const review = await response.json();
        await apiPost('commit', {
            accountId: account.id,
            reviewId: review.reviewId,
            rows: review.rows,
        });
    }
    await page
        .getByRole('button', { name: 'CSV 내보내기', exact: true })
        .click();
    await select('내보낼 자료', '저장된 전체 거래');
    const transactionsCsv = await downloadCsv();
    assert.equal(transactionsCsv.trim().split('\r\n').length, 202);
    assert.match(transactionsCsv, /export-trade-200/);
    await page.keyboard.press('Escape');

    // A viewer can export readable data, but revoking access after opening the
    // dialog prevents a stale UI from downloading the previous snapshot.
    const viewerUid = uid + '-viewer';
    const invitation = await apiPost('invite', { familyId });
    await apiPost(
        'join',
        { invitation: invitation.invitation, name: '조회자' },
        viewerUid
    );
    await apiPost('grant', {
        accountId: account.id,
        uid: viewerUid,
        role: 'viewer',
    });
    const viewer = await browser.newPage({
        viewport: { width: 390, height: 900 },
    });
    await viewer.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import { ref, computed } from '/node_modules/.vite/deps/vue.js'; export const firebaseUser = ref({ uid: '${viewerUid}', getIdToken: async () => '${viewerUid}' }); export const authLoading = ref(false), signedIn = computed(() => true); export const firebaseReady = false, db = null, auth = null, googleProvider = null;`,
        })
    );
    await viewer.route('**/api/portfolio-capital*', (route) =>
        route.fulfill({
            json: { entries: [], classifications: [], allocations: [] },
        })
    );
    await viewer.goto(base + '/mypage');
    await viewer
        .getByRole('button', { name: '가족 포트폴리오', exact: true })
        .click();
    await viewer
        .getByRole('button', { name: 'CSV 내보내기', exact: true })
        .click();
    assert.match(await downloadCsv(viewer), /"AAPL","2","500","USD"/);
    await apiPost('grant', {
        accountId: account.id,
        uid: viewerUid,
        role: 'none',
    });
    let rejectedDownloads = 0;
    viewer.on('download', () => rejectedDownloads++);
    await viewer
        .getByRole('button', { name: 'CSV 다운로드', exact: true })
        .click();
    await viewer
        .getByText(/이 계좌의 조회 권한을 확인할 수 없습니다/)
        .waitFor();
    assert.equal(rejectedDownloads, 0);
    await viewer.close();
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
        await page
            .getByRole('button', { name: 'CSV 내보내기', exact: true })
            .click();
        const dialog = page.getByRole('dialog', {
            name: 'CSV 내보내기',
            exact: true,
        });
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        await page.screenshot({
            animations: 'disabled',
            path: `${output}/${width}-portfolio-export.png`,
        });
        await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
        `${output}/portfolio-results.json`,
        JSON.stringify(
            {
                layouts,
                errors,
                flow: 'register → preview/repair/save → success/duplicate/history receipts → holdings CSV → 201 transaction rows → viewer export/revoked access → family scopes',
            },
            null,
            2
        )
    );
    console.log(
        'PASS: portfolio imports/receipts, holdings and 201-row transaction CSV exports, viewer/revoked access, family scopes, 16 layouts and 4 export dialog widths'
    );
} finally {
    await browser.close();
}
