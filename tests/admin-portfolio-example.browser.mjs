import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
    args: ['--no-sandbox'],
});

try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        await page.route('**/src/services/firebaseClient*', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';const user={uid:'admin-example-test'};export const firebaseUser=ref(user),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,auth=null,db=null,googleProvider=null;`,
            })
        );
        await page.route('**/lib/portfolio-admin.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: 'export function isPortfolioAdmin() { return true; }',
            })
        );

        await page.goto(`${base}/admin/portfolio-example`);
        await page
            .getByRole('heading', { name: '회수율을 판단하는 5가지 기준' })
            .waitFor();
        await page
            .getByText(/환전한 원화는 별도로 더하지 않습니다/, {
                exact: false,
            })
            .waitFor();
        await page
            .getByText(/사용자가 확인한 세후 청산가치를 입력해야 합니다/, {
                exact: false,
            })
            .waitFor();

        const dimensions = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
        }));
        assert.ok(
            dimensions.scrollWidth <= dimensions.clientWidth,
            `horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
