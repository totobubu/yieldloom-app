// Source CSS d33c8e... / 87cd20...: card22/16px, metrics4/2/1, labelled facts cards <=1024px.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage();
    await installStitchFixtures(page);
    for (const tab of ['details', 'prices'])
        for (const width of [1280, 1024, 768, 390]) {
            await page.setViewportSize({ width, height: 1024 });
            await page.goto(
                (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                    '/stock/DEMO-A?tab=' +
                    tab
            );
            await page.locator('.stock-overview article').nth(3).waitFor();
            const metrics = await page
                .locator('.stock-summary-card')
                .evaluate((element) => ({
                    padding: parseFloat(getComputedStyle(element).paddingLeft),
                    columns: getComputedStyle(
                        element.querySelector('.stock-overview')
                    ).gridTemplateColumns.split(/\s+/).length,
                }));
            assert.equal(metrics.padding, width <= 768 ? 16 : 22);
            assert.equal(
                metrics.columns,
                width <= 768 ? 1 : width <= 1024 ? 2 : 4
            );
            assert.equal(
                (
                    await page
                        .locator('.stock-overview article')
                        .nth(2)
                        .locator('strong')
                        .innerText()
                ).trim(),
                '1.04'
            );
            if (tab === 'details') {
                const facts = await page
                    .locator('.stock-facts > div')
                    .first()
                    .evaluate((row) => {
                        const label = row.querySelector('dt'),
                            value = row.querySelector('dd');
                        return {
                            display: getComputedStyle(row).display,
                            width: row.getBoundingClientRect().width,
                            label: label.getBoundingClientRect().toJSON(),
                            value: value.getBoundingClientRect().toJSON(),
                            labelPadding: getComputedStyle(label).paddingLeft,
                        };
                    });
                if (width <= 1024) {
                    assert.equal(facts.display, 'block');
                    assert.ok(
                        Math.abs(facts.label.width - facts.value.width) < 1
                    );
                    assert.ok(
                        facts.value.y >= facts.label.y + facts.label.height - 1
                    );
                } else {
                    assert.equal(facts.display, 'grid');
                    assert.ok(
                        Math.abs(facts.label.width - facts.width * 0.32) < 1
                    );
                    assert.equal(facts.labelPadding, '14px');
                    assert.ok(
                        facts.value.x >= facts.label.x + facts.label.width - 1
                    );
                    assert.ok(
                        facts.value.x + facts.value.width <=
                            facts.label.x + facts.width + 1
                    );
                }
                assert.equal(
                    await page
                        .locator('#feedback-message')
                        .evaluate(
                            (element) => getComputedStyle(element).height
                        ),
                    '100px'
                );
            }
            if (tab === 'prices') {
                const history = page.locator('.stock-price-history');
                await history
                    .locator('.price-observation-cards article')
                    .first()
                    .waitFor({ state: 'attached' });
                await page
                    .locator('.fullscreen-data-loading-mask')
                    .waitFor({ state: 'hidden' });
                assert.equal(
                    await history
                        .locator('.price-observation-table')
                        .isVisible(),
                    width >= 1024
                );
                assert.equal(
                    await history
                        .locator('.price-observation-cards')
                        .isVisible(),
                    width < 1024
                );
                assert.equal(
                    await history
                        .getByRole('button', { name: '표', exact: true })
                        .getAttribute('aria-pressed'),
                    'true'
                );
                if (width < 1024) {
                    assert.equal(
                        await history
                            .locator('.price-observation-cards article')
                            .count(),
                        10
                    );
                    await history
                        .getByRole('button', { name: /시세 이력 더 보기/ })
                        .click();
                    assert.equal(
                        await history
                            .locator('.price-observation-cards article')
                            .count(),
                        20
                    );
                }
            }
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                )
            );
        }
    console.log(
        'PASS: detail/price source spacing, 4/2/1 metrics, stacked facts, feedback height at 4 widths; unchanged TTM; no overflow'
    );
} finally {
    await browser.close();
}
