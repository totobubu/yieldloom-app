/* global getComputedStyle, document, innerWidth -- isolated browser callbacks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5279';
const out = process.env.ACCOUNT_CARD_EVIDENCE_DIR || '/tmp/phase79/after';
const before = process.env.ACCOUNT_CARD_BASELINE === '1';
await fs.mkdir(out, { recursive: true });
const html = await fs.readFile(
    'docs/design/stitch-v2/originals/7356929996797649648/b611bd07ed0c464581479140b9207afb.html',
    'utf8'
);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = (el, source) => {
    const st = (x) => {
        const s = getComputedStyle(x),
            r = x.getBoundingClientRect();
        return {
            font: s.fontSize,
            line: s.lineHeight,
            weight: s.fontWeight,
            height: r.height,
            width: r.width,
            padding: s.padding,
            radius: s.borderRadius,
        };
    };
    const owner = el.querySelector(
        source
            ? '.font-title-md.text-title-md'
            : '.account-card-identity strong'
    );
    const institution = source
        ? owner.nextElementSibling
        : el.querySelector('.account-card-identity>span');
    const role = source
        ? el.querySelector('.font-label-sm.text-label-sm.font-semibold')
        : el.querySelector('.account-card-role>span');
    const type = source
        ? role.nextElementSibling
        : el.querySelector('.account-card-role>span:last-child');
    const snapshot = source
        ? el.querySelector('.p-3.flex.flex-col')
        : el.querySelector('.account-card-snapshot');
    const tool = [...el.querySelectorAll('button')].find((x) =>
        x.textContent.includes('별칭 수정')
    );
    return {
        card: st(el),
        owner: st(owner),
        institution: st(institution),
        role: st(role),
        type: st(type),
        snapshot: st(snapshot),
        tool: st(tool),
        columns: getComputedStyle(el.parentElement).gridTemplateColumns.split(
            ' '
        ).length,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
};
try {
    for (const width of [1280, 1024, 834, 390]) {
        const source = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const sourceErrors = [];
        source.on('pageerror', (e) => sourceErrors.push(e.message));
        const sourceAssets = await installStaticAssets(source);
        await source.setContent(html, { waitUntil: 'networkidle' });
        await source.evaluate(() => document.fonts.ready);
        const sc = source.locator('#acc-card-1');
        const original = await sc.evaluate(measure, true);
        await sc.screenshot({
            path: `${out}/source-${width}.png`,
            animations: 'disabled',
        });
        const p = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(p, { admin: true });
        const assets = await installStaticAssets(p);
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        await p.goto(base + '/mypage?tab=assets');
        const card = p.locator('.accounts li').first();
        await card.waitFor();
        await p
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await p.evaluate(() => document.fonts.ready);
        const app = await card.evaluate(measure, false);
        await card.screenshot({
            path: `${out}/app-${width}.png`,
            animations: 'disabled',
        });
        rows.push({
            width,
            original,
            app,
            sourceErrors,
            sourceAssets,
            errors,
            assets,
        });
        assert.deepEqual(sourceErrors, []);
        assert.deepEqual(sourceAssets, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(assets, []);
        assert.equal(app.overflow, false);
        if (!before) {
            assert.equal(app.card.padding, original.card.padding);
            assert.equal(app.card.radius, original.card.radius);
            if (width !== 1024) assert.equal(app.columns, original.columns); // 1024px shell leaves a narrower content slot; keep safe single column.
            for (const key of ['owner', 'institution', 'role', 'type'])
                for (const prop of ['font', 'line'])
                    assert.equal(
                        app[key][prop],
                        original[key][prop],
                        `${width} ${key}.${prop}`
                    );
            assert.equal(app.owner.weight, original.owner.weight);
            assert.equal(app.tool.height, original.tool.height);
            assert.equal(app.snapshot.padding, original.snapshot.padding);
        }
        await p.close();
        await source.close();
    }
} finally {
    await browser.close();
    await fs.writeFile(
        out + '/geometry.json',
        JSON.stringify(
            {
                before,
                knownUnaccepted: [
                    '1024px reference3 columns vs live shell1 column; narrower708px content slot retained',
                    'PC host width, real metadata/alias and holdings wraps may change full card height',
                    'Unsupported original-file control remains disabled and labeled; no fake link',
                ],
                scope: 'Selected card properties only; actual institution/alias/permissions/holdings remain synthetic service data and are not replaced with source examples; whole native PNG/font acceptance incomplete',
                rows,
            },
            null,
            2
        ) + '\n'
    );
}
console.log(
    `PASS ${rows.length} widths: source-backed account-card properties`
);
