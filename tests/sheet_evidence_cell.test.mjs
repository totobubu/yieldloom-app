// Render the actual Vue component against synthetic props only. No browser,
// credentials, broker requests or writes to any ledger are involved.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import PrimeVue from 'primevue/config';
import { load } from 'cheerio';

let server, Cell;
before(async () => {
    server = await createServer({
        configFile: false,
        plugins: [vue()],
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'custom',
    });
    Cell = (
        await server.ssrLoadModule(
            '/src/components/portfolio/SheetEvidenceCell.vue'
        )
    ).default;
});
after(async () => server?.close());

const source = (value, overrides = {}) => ({
    id: 'baseline',
    value,
    label: '구글 시트',
    location: '합성 1행',
    eligible: true,
    ...overrides,
});
async function render(current, sources, props = {}, comparison = {}) {
    const input = { current, sources, ...comparison };
    const before = structuredClone(input);
    const app = createSSRApp({
        render: () =>
            h(Cell, {
                comparison: input,
                label: '거래일',
                rowLabel: '합성 거래',
                format: String,
                hideMatchingSources: true,
                ...props,
            }),
    });
    app.use(PrimeVue, { unstyled: true });
    const html = await renderToString(app);
    assert.deepEqual(
        input,
        before,
        'Rendering must not change source or approval values'
    );
    return load(html);
}

test('equal date is shown once while its provenance remains available', async () => {
    const $ = await render('2026-10-22', [source('2026-10-22')]);
    assert.equal($('.evidence-cell').text().trim(), '2026-10-22');
    assert.match($('strong').attr('title'), /구글 시트 · 합성 1행/);
});

test('different source dates and the approval control remain visible', async () => {
    const $ = await render(
        '2026-10-22',
        [
            source('2026-10-22'),
            source('2026-10-23', { id: 'toss', label: '토스 거래내역' }),
        ],
        {},
        { conflict: true, needsChoice: true }
    );
    assert.match($('.evidence-cell').text(), /토스 거래내역: 2026-10-23/);
    assert.match($('.evidence-cell').text(), /출처 값 충돌 · 승인 필요/);
    assert.equal(
        $('[role="combobox"]').attr('aria-label'),
        '합성 거래 거래일 승인값'
    );
});

test('equal but ineligible sources retain the link warning', async () => {
    const $ = await render('2026-10-22', [
        source('2026-10-22', { eligible: false }),
    ]);
    assert.match($('.evidence-cell').text(), /연결 확인 필요/);
});

test('missing time stays missing and source time keeps its exact precision', async () => {
    const $ = await render(null, [source('2026-10-22 14:51:09.123')], {
        label: '거래시간',
    });
    assert.equal($('.missing').text(), '미제공');
    assert.match($('.evidence-cell').text(), /14:51:09\.123/);
    const empty = await render(null, [], { label: '거래시간' });
    assert.equal(empty('.evidence-cell').text().trim(), '미제공');
});

test('date-only and precise timestamps are not treated as identical', async () => {
    const $ = await render('2026-10-22', [source('2026-10-22 00:00')]);
    assert.match($('.evidence-cell').text(), /구글 시트: 2026-10-22 00:00/);
});

test('numeric source display is unchanged by default', async () => {
    const $ = await render(12, [source(12)], { hideMatchingSources: false });
    assert.match($('.evidence-cell').text(), /구글 시트: 12/);
});
