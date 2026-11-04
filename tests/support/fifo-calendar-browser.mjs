import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Served only by local Vite; all rows are synthetic. No auth, DB or financial API.
export async function checkReviewCalendar(browser, base) {
    const page = await browser.newPage({
        viewport: { width: 1100, height: 1000 },
    });
    const errors = [],
        network = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (route) => {
        network.push(route.request().url());
        return route.abort();
    });
    const compiled = await (
        await page.request.get(
            base + '/src/components/portfolio/FifoReviewCalendar.vue'
        )
    ).text();
    const appEntry = await (
        await page.request.get(base + '/src/main.js')
    ).text();
    const primeVueModule = appEntry.match(
        /from "([^"]*primevue_config\.js[^"]*)"/
    )?.[1];
    assert.ok(primeVueModule, 'Use the installed optimized PrimeVue entry');
    const vueModule = compiled.match(/from "([^"]*vue\.js[^"]*)"/)?.[1];
    assert.ok(
        vueModule,
        'Use the same Vue runtime as the Vite-compiled component'
    );
    // Browser-local route: deleting a transformed inline-module HTML entry can broadcast full-reload
    // to sibling app tabs and destroys their local selected view.
    await page.route('**/.tmp-fifo-calendar.html', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        :root{--app-text:#172033;--app-text-muted:#505968;--app-surface:#fff;--app-surface-muted:#f3f5fa;--app-border:#d6d9df}body{font-family:sans-serif;margin:16px;color:var(--app-text);background:var(--app-surface)}.p-dark{--app-text:#eee;--app-text-muted:#b7c0d0;--app-surface:#1f2937;--app-surface-muted:#253347;--app-border:#6b7280}
        </style><div id="app"></div><script type="module">
        import {createApp,h,ref} from '${vueModule}';import PrimeVue from '${primeVueModule}';import {MyPreset} from '/src/config/theme.js';import Calendar from '/src/components/portfolio/FifoReviewCalendar.vue';
        const events=ref([
            {id:'shared',accountId:'wife',type:'BUY',symbol:'ALPHA',currency:'USD',at:'2024-02-29T00:01:00+14:00'},
            {id:'shared',accountId:'husband',type:'SELL',symbol:'ALPHA',currency:'USD',at:'2024-02-29T23:59:00-12:00'},
            {id:'dividend',accountId:'wife',type:'DIVIDEND',symbol:'ALPHA',currency:'USD',at:'2024-02-29'},
            {id:'unknown',accountId:'wife',type:'BUY',symbol:'BETA',currency:'KRW',at:null},
            {id:'invalid',accountId:'husband',type:'DIVIDEND',symbol:'BETA',currency:'USD',at:'2023-02-29'},
            {id:'next',accountId:'wife',type:'BUY',symbol:'BETA',currency:'KRW',at:'2024-03-01'}
        ]);
        createApp({render:()=>h(Calendar,{events:events.value},{default:({events})=>h('ul',{'aria-label':'합성 검토 내역'},events.map(e=>h('li',{key:e.accountId+e.id},e.type+' '+e.symbol+' '+(e.at||'날짜 미상'))))})}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}}}).mount('#app');
        </script></html>`,
        })
    );
    try {
        await page.goto(base + '/.tmp-fifo-calendar.html');
        const region = page.getByRole('region', { name: '일별 장부 검토' });
        await region.getByRole('heading', { name: '2024년 3월' }).waitFor();
        const rows = page
            .getByRole('list', { name: '합성 검토 내역' })
            .getByRole('listitem');
        assert.equal(await rows.count(), 6);
        await region
            .getByRole('button', { name: '이전 달', exact: true })
            .click();
        const leapDay = region.getByRole('button', {
            name: '2024-02-29, 3건',
            exact: true,
        });
        await leapDay.focus();
        await page.keyboard.press('Enter');
        assert.equal(await rows.count(), 3);
        assert.equal(await leapDay.getAttribute('aria-pressed'), 'true');
        await leapDay.click();
        assert.equal(await rows.count(), 3, 'repeat click remains selected');
        await page.keyboard.press('ArrowRight');
        assert.equal(
            await page.locator(':focus').getAttribute('data-review-date'),
            '2024-03-01'
        );
        await page.keyboard.press('Space');
        assert.equal(await rows.count(), 1);
        await page.keyboard.press('PageUp');
        assert.equal(
            await page.locator(':focus').getAttribute('data-review-date'),
            '2024-02-01'
        );
        await page.keyboard.press('Home');
        assert.equal(
            await page.locator(':focus').getAttribute('data-review-date'),
            '2024-01-28'
        );
        await page.keyboard.press('Enter');
        assert.equal(await rows.count(), 0);
        await region
            .getByText('2024-01-28에 해당하는 내역이 없습니다.', {
                exact: true,
            })
            .waitFor();
        await region
            .getByRole('button', { name: '날짜 미상 2건', exact: true })
            .click();
        assert.equal(await rows.count(), 2);
        await region.getByRole('button', { name: '전체 날짜 보기' }).click();
        assert.equal(await rows.count(), 6);
        await region
            .getByRole('button', { name: '이전 달', exact: true })
            .click();
        await region.getByRole('heading', { name: '2023년 12월' }).waitFor();
        await region
            .getByRole('button', { name: '다음 달', exact: true })
            .click();
        await region
            .getByRole('button', { name: '다음 달', exact: true })
            .click();
        await region.getByRole('textbox', { name: '내역 검색' }).fill('ALPHA');
        await region
            .getByRole('button', { name: '2024-02-29, 3건', exact: true })
            .click();
        assert.equal(await rows.count(), 3);
        await page.screenshot({
            path: join(tmpdir(), 'yieldloom-review-calendar-desktop.png'),
            fullPage: true,
            animations: 'disabled',
        });
        await page.setViewportSize({ width: 390, height: 844 });
        for (const dark of [false, true]) {
            await page.evaluate(
                (dark) =>
                    document.documentElement.classList.toggle('p-dark', dark),
                dark
            );
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth
                ),
                true
            );
            assert.equal(
                await region
                    .locator('button.calendar-day')
                    .first()
                    .evaluate((el) => el.getBoundingClientRect().height >= 44),
                true
            );
            assert.equal(
                await region.evaluate((el) =>
                    [...el.querySelectorAll('*')].every(
                        (node) =>
                            !(
                                node.scrollHeight > node.clientHeight + 1 &&
                                ['auto', 'scroll'].includes(
                                    getComputedStyle(node).overflowY
                                )
                            )
                    )
                ),
                true
            );
            await page.screenshot({
                path: join(
                    tmpdir(),
                    `yieldloom-review-calendar-mobile-${dark ? 'dark' : 'light'}.png`
                ),
                fullPage: true,
                animations: 'disabled',
            });
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(network, []);
    } catch (error) {
        error.message += '; fixture errors: ' + JSON.stringify(errors);
        throw error;
    } finally {
        await page.close();
    }
}
