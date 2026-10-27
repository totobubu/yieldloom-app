import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { load } from 'cheerio';
let server, Table, Times;
before(async () => {
    server = await createServer({
        configFile: false,
        plugins: [vue()],
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'custom',
    });
    Table = (
        await server.ssrLoadModule(
            '/src/components/portfolio/SheetEvidenceRequirements.vue'
        )
    ).default;
    Times = (
        await server.ssrLoadModule(
            '/src/components/portfolio/SheetSourceTimes.vue'
        )
    ).default;
});
after(async () => server?.close());
test('requirements remain guidance; source summary is not rewritten as verified', async () => {
    const holds = ['money', 'ymax', 'multi', 'sample'].map((id) => ({
        id,
        title: id,
        count: 2,
        unit: '합성행',
        note: '보존된 합성 설명',
    }));
    const before = structuredClone(holds);
    const $ = load(
        await renderToString(
            createSSRApp({ render: () => h(Table, { holds }) })
        )
    );
    assert.equal($('tbody tr').length, 4);
    assert.match($('table').text(), /1:N/);
    assert.match($('table').text(), /출금 월·일/);
    assert.match($('table').text(), /동일 시각의 별도 주문/);
    assert.match($('table').text(), /모든 차이 행의 수작업 검토를 요구하지/);
    assert.deepEqual(holds, before);
});
test('posting time renders exact precision and no timezone or execution claim', async () => {
    const candidates = [
        {
            id: 'synthetic',
            quantity: null,
            times: [
                {
                    role: 'dateTime',
                    field: 'data.transaction.dateTime',
                    value: '2025-11-26 08:30:53.776',
                    timeZone: null,
                },
            ],
            source: {
                archiveKey: 'private/synthetic.json',
                file: 'synthetic.json',
                sha256: 'a'.repeat(64),
            },
        },
    ];
    const $ = load(
        await renderToString(
            createSSRApp({ render: () => h(Times, { candidates }) })
        )
    );
    assert.match(
        $('.source-time-preview').text(),
        /거래내역 기록 시각:.*2025-11-26 08:30:53\.776/s
    );
    assert.match($('details').text(), /시간대 미명시/);
    assert.match($('details').text(), /동일 거래로 승인한 값은 아닙니다/);
    assert.doesNotMatch($('body').text(), /KST|UTC|체결 시각/);
});
