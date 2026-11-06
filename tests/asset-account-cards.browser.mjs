// Presentational account-card contract only: synthetic props, no authentication or API access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const out = process.env.ACCOUNT_CARDS_TEST_DIR;
if (out) await fs.mkdir(out, { recursive: true });
const examples = [
    {
        id: 'owner',
        role: 'owner',
        authorityUid: 'synthetic',
        type: 'general',
        label: '일반',
        rename: true,
    },
    {
        id: 'editor',
        role: 'editor',
        authorityUid: 'synthetic',
        type: 'isa',
        label: 'ISA',
        rename: true,
    },
    {
        id: 'viewer',
        role: 'viewer',
        authorityUid: 'synthetic',
        type: 'pension',
        label: '연금',
        rename: false,
    },
    {
        id: 'foreign-authority',
        role: 'owner',
        authorityUid: 'other',
        type: 'other',
        label: '기타',
        rename: false,
    },
    {
        id: 'unknown-role',
        role: 'not-a-role',
        authorityUid: 'synthetic',
        type: 'not-a-type',
        label: '유형 미확인',
        rename: false,
    },
    {
        id: 'missing-role',
        authorityUid: 'synthetic',
        type: null,
        label: '유형 미확인',
        rename: false,
    },
    {
        id: 'prototype-name',
        role: 'viewer',
        authorityUid: 'synthetic',
        type: '__proto__',
        label: '유형 미확인',
        rename: false,
    },
    {
        id: 'invalid-type',
        role: 'viewer',
        authorityUid: 'synthetic',
        type: { toString: null },
        label: '유형 미확인',
        rename: false,
    },
];
examples.push({
    id: 'prototype-role',
    role: '__proto__',
    authorityUid: 'synthetic',
    type: 'general',
    label: '일반',
    rename: false,
});
const accounts = examples.map((x) => ({
    id: x.id,
    ownerId: x.id,
    institution: '합성 기관',
    alias: x.id,
    maskedNumber: '****0000',
    authorityUid: x.authorityUid,
    permissions: x.role ? { synthetic: x.role } : {},
    type: x.type,
    snapshot: {
        source: '합성 검증 자료',
        asOf: '2026-11-03',
        rows: [{ symbol: 'DEMO', quantity: 0, amount: null, currency: 'USD' }],
    },
}));
const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">
import {createApp,h,ref} from '/node_modules/.vite/deps/vue.js';
import PrimeVue from '/node_modules/.vite/deps/primevue_config.js';
import AccountCards from '/src/components/portfolio/AssetAccountList.vue';
import {MyPreset} from '/src/config/theme.js';
import '/src/styles/style.scss';import '/src/styles/studio.scss';
const accounts=${JSON.stringify(accounts)};
const app=createApp({setup(){const selected=ref('owner'),busy=ref(false),events=ref([]);return()=>h('main',{style:'padding:20px'},[h('h1','합성 계좌 카드 검증'),h('button',{id:'busy',onClick:()=>busy.value=!busy.value},'처리 상태 전환'),h('button',{id:'theme',onClick:()=>document.documentElement.classList.toggle('p-dark')},'테마 전환'),h(AccountCards,{accounts,selected:selected.value,userId:'synthetic',busy:busy.value,ownerName:id=>'예시 '+id,onSelect:id=>{selected.value=id;events.value.push(['select',id])},onRename:id=>events.value.push(['rename',id])}),h('output',{id:'events'},JSON.stringify(events.value))])}});app.use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}}});app.mount('#app');
</script></body></html>`;
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1280, 834, 390]) {
        const p = await browser.newPage({ viewport: { width, height: 1100 } });
        const errors = [],
            apis = [];
        p.on('pageerror', (e) => errors.push(e.message));
        p.on('request', (r) => {
            if (new URL(r.url()).pathname.startsWith('/api/'))
                apis.push(r.method());
        });
        await p.route('https://**/*', (r) => r.abort());
        await p.route('**/tests/phase79-account-cards.html', (r) =>
            r.fulfill({ contentType: 'text/html', body: html })
        );
        await p.goto(base + '/tests/phase79-account-cards.html');
        await p.locator('.accounts li').last().waitFor();
        assert.equal(await p.locator('.accounts li').count(), examples.length);
        const beforeFinancial = await p
            .locator('.account-card-snapshot')
            .allTextContents();
        for (let i = 0; i < examples.length; i++) {
            const x = examples[i],
                card = p.locator('.accounts li').nth(i);
            assert.equal(
                (
                    await card
                        .locator('.account-card-role>span:last-child')
                        .innerText()
                ).trim(),
                x.label
            );
            if (!['owner', 'editor', 'viewer'].includes(x.role))
                assert.equal(
                    (
                        await card.locator('.account-role-label').innerText()
                    ).trim(),
                    '권한 미확인'
                );
            const selection = card.locator('.account-card-select');
            const selectionName = await selection.getAttribute('aria-label');
            assert.ok(selectionName.includes(x.label));
            assert.ok(
                selectionName.includes('예시 ' + x.id),
                'Selection must identify the actual permitted owner to screen readers'
            );
            assert.ok(
                selectionName.includes(
                    (
                        await card.locator('.account-role-label').innerText()
                    ).trim()
                ),
                'Screen readers must retain the permission description after grouping the header'
            );
            const button = card.getByRole('button', {
                name: x.rename ? '별칭 수정' : '별칭 수정 불가',
                exact: true,
            });
            assert.equal(await button.isDisabled(), !x.rename);
            assert.match(
                await card.locator('.account-card-snapshot').innerText(),
                /DEMO.*0.*미확인.*USD/s
            );
            assert.equal(
                await card
                    .getByRole('button', {
                        name: '출처 원본 (미지원)',
                        exact: true,
                    })
                    .isDisabled(),
                true
            );
            if (!x.rename) await button.evaluate((e) => e.click());
        }
        assert.equal(await p.locator('#events').innerText(), '[]');
        await p
            .locator('.accounts li')
            .nth(2)
            .locator('.account-card-select')
            .focus();
        await p.keyboard.press('Enter');
        assert.equal(
            await p
                .locator('.accounts li')
                .nth(2)
                .locator('.account-card-select')
                .getAttribute('aria-pressed'),
            'true'
        );
        assert.deepEqual(JSON.parse(await p.locator('#events').innerText()), [
            ['select', 'viewer'],
        ]);
        await p
            .locator('.accounts li')
            .first()
            .getByRole('button', { name: '별칭 수정', exact: true })
            .focus();
        await p.keyboard.press('Enter');
        assert.deepEqual(JSON.parse(await p.locator('#events').innerText()), [
            ['select', 'viewer'],
            ['rename', 'owner'],
        ]);
        await p.locator('#busy').click();
        assert.equal(
            await p.locator('.accounts button:disabled').count(),
            examples.length * 3
        );
        const held = await p.locator('#events').innerText();
        await p
            .locator('.account-card-select')
            .first()
            .evaluate((e) => e.click());
        assert.equal(await p.locator('#events').innerText(), held);
        await p.locator('#busy').click();
        await p.locator('#theme').click();
        assert.equal(await p.locator('html.p-dark').count(), 1);
        assert.deepEqual(
            await p.locator('.account-card-snapshot').allTextContents(),
            beforeFinancial
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(apis, []);
        assert.ok(
            await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        if (out)
            await p.screenshot({
                path: out + '/' + width + '-dark.png',
                fullPage: true,
                animations: 'disabled',
            });
        console.log(
            'PASS account-cards/' +
                width +
                ': nine role/type cases, disabled native actions, viewer selection, rename ID, busy, dark, unchanged zero/missing values, API0'
        );
        await p.close();
    }
} finally {
    await browser.close();
}
