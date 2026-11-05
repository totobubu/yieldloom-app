/* global document -- isolated reference DOM, fixed synthetic text only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output = `${process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review'}/checks/phase17/holdings-data-replay`;
const file =
    'docs/design/stitch-v2/originals/7356929996797649648/d90f121fb719421e880cc02309349add.html';
const html = await fs.readFile(file, 'utf8'),
    hash = crypto.createHash('sha256').update(html).digest('hex');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
try {
    for (const width of [768, 390]) {
        const app = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(app, { admin: true });
        await installStaticAssets(app);
        await app.goto(base + '/mypage?tab=overview&view=holdings');
        const card = app.locator('.holding-card').first();
        await card.waitFor();
        await app
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await app.evaluate(() => document.fonts.ready);
        const text = await card.evaluate((el) => {
            const dd = el.querySelector('dd').cloneNode(true);
            const badge = dd.querySelector('.holding-access');
            const role = badge.textContent;
            badge.remove();
            return {
                prefix: dd.textContent.replace(/\s+/g, ' ').trim(),
                role,
                name: el.querySelector('.holding-identity p').textContent,
            };
        });
        const source = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStaticAssets(source);
        await source.setContent(html, { waitUntil: 'networkidle' });
        await source.evaluate(() => document.fonts.ready);
        const original = source.locator('.holder-card-item').first(),
            before = await original.boundingBox();
        await original.evaluate((el, text) => {
            const target = el.children[2].children[0].lastElementChild;
            const badge = target.querySelector('span').cloneNode(true);
            badge.textContent = text.role;
            target.replaceChildren(
                document.createTextNode(text.prefix + ' '),
                badge
            );
            el.querySelector('p').textContent = text.name;
        }, text);
        const replay = await original.boundingBox(),
            implementation = await card.boundingBox();
        await original.screenshot({
            path: `${output}/source-text-replay-${width}.png`,
            animations: 'disabled',
        });
        await card.screenshot({
            path: `${output}/implementation-${width}.png`,
            animations: 'disabled',
        });
        rows.push({
            width,
            before,
            replay,
            implementation,
            syntheticTextOnly: text,
            heightMatch: Math.abs(replay.height - implementation.height) < 1,
            widthMatch: replay.width === implementation.width,
        });
        await source.close();
        await app.close();
    }
} finally {
    await browser.close();
}
assert.equal(
    crypto
        .createHash('sha256')
        .update(await fs.readFile(file))
        .digest('hex'),
    hash
);
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        {
            source: file,
            sha256: hash,
            scope: 'Only provided synthetic account/name text replayed in isolated source DOM. Original file, CSS, amounts, permissions and application data not modified. Not whole-screen acceptance.',
            rows,
        },
        null,
        2
    ) + '\n'
);
console.log(
    JSON.stringify(
        rows.map((r) => ({
            width: r.width,
            before: r.before.height,
            replay: r.replay.height,
            implementation: r.implementation.height,
        }))
    )
);
assert.ok(
    rows.every((row) => row.heightMatch && row.widthMatch),
    'Data replay must be measured, not assumed equivalent'
);
