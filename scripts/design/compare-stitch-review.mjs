/* global document, Image -- Playwright canvas callback. */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const output =
    process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const page = await browser.newPage();
const rows = [];
try {
    await fs.mkdir(`${output}/comparisons`, { recursive: true });
    for (const width of [1280, 768, 390]) {
        const original =
            width === 1280
                ? `${output}/originals/7356929996797649648/6e69286f8e3d4f98b3cbc125f2b2ecd0.png`
                : `${output}/rendered-originals/6e69286f8e3d4f98b3cbc125f2b2ecd0-${width}.png`;
        const implementation = `${output}/implementation/search-content-${width}.png`;
        const images = await Promise.all(
            [original, implementation].map(
                async (file) =>
                    `data:image/png;base64,${(await fs.readFile(file)).toString('base64')}`
            )
        );
        const result = await page.evaluate(async (urls) => {
            const images = await Promise.all(
                urls.map(
                    (src) =>
                        new Promise((resolve, reject) => {
                            const image = new Image();
                            image.onload = () => resolve(image);
                            image.onerror = reject;
                            image.src = src;
                        })
                )
            );
            const width = Math.max(...images.map((image) => image.width)),
                height = Math.max(...images.map((image) => image.height));
            const canvases = images.map((image) => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d');
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, width, height);
                context.drawImage(image, 0, 0);
                return canvas;
            });
            const contexts = canvases.map((canvas) => canvas.getContext('2d'));
            const data = contexts.map((context) =>
                context.getImageData(0, 0, width, height)
            );
            const difference = document.createElement('canvas');
            difference.width = width;
            difference.height = height;
            const context = difference.getContext('2d');
            const pixels = context.createImageData(width, height);
            let changed = 0;
            for (let i = 0; i < data[0].data.length; i += 4) {
                const delta = Math.max(
                    ...[0, 1, 2].map((c) =>
                        Math.abs(data[0].data[i + c] - data[1].data[i + c])
                    )
                );
                if (delta > 32) changed++;
                pixels.data[i] = delta > 32 ? 220 : 245;
                pixels.data[i + 1] = delta > 32 ? 38 : 245;
                pixels.data[i + 2] = delta > 32 ? 38 : 245;
                pixels.data[i + 3] = 255;
            }
            context.putImageData(pixels, 0, 0);
            const combined = document.createElement('canvas');
            combined.width = width * 3;
            combined.height = height;
            const combinedContext = combined.getContext('2d');
            [canvases[0], canvases[1], difference].forEach((canvas, i) =>
                combinedContext.drawImage(canvas, i * width, 0)
            );
            return {
                originalSize: [images[0].width, images[0].height],
                implementationSize: [images[1].width, images[1].height],
                comparedSize: [width, height],
                changedPixels: changed,
                totalPixels: width * height,
                differenceRatio: changed / (width * height),
                png: combined.toDataURL('image/png').split(',')[1],
            };
        }, images);
        const { png, ...metrics } = result;
        await fs.writeFile(
            `${output}/comparisons/search-${width}.png`,
            Buffer.from(png, 'base64')
        );
        rows.push({
            viewportWidth: width,
            sourceImageKind:
                width === 1280
                    ? 'downloaded-original-PNG'
                    : 'source-HTML-rendered-at-viewport-no-original-device-PNG',
            deviceScaleFactor: 2,
            sourceScreenId: '6e69286f8e3d4f98b3cbc125f2b2ecd0',
            status: 'not-pixel-equivalent',
            panels: 'left: source HTML; middle: live Vue content; right: differences >32/channel; no resizing',
            ...metrics,
        });
    }
    await fs.writeFile(
        `${output}/comparisons/results.json`,
        JSON.stringify(
            {
                status: 'incomplete',
                warning:
                    'Diagnostic only. Larger content heights are white-padded, never scaled. Source fixture and live contract differ in current price availability and classifications.',
                rows,
            },
            null,
            2
        )
    );
    console.log(
        rows.map(({ viewportWidth, differenceRatio }) => ({
            viewportWidth,
            differenceRatio,
        }))
    );
} finally {
    await browser.close();
}
