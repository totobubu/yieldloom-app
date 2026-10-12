import { zipSync, strToU8 } from 'fflate';

const safeName = (value) => String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

export function createPublishPackage({ symbol, tone, cards, sourceStatus }) {
    const files = {};
    const manifest = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        symbol,
        tone,
        dataStatus: sourceStatus,
        cards: cards.map(({ kind, filename, text, sourceUrl, asOfDate }) => ({ kind, filename, text, sourceUrl, asOfDate })),
    };
    const sources = cards.map((card) => `## ${card.label}\n- 기준일: ${card.asOfDate || '미정'}\n- 출처: ${card.sourceUrl || '확인 불가'}\n- 상태: ${sourceStatus}\n`).join('\n');
    for (const card of cards) {
        files[card.filename] = card.png;
        files[`${safeName(symbol)}_${card.kind}.txt`] = strToU8(card.text);
    }
    files['sources.md'] = strToU8(`# ${symbol} 게시 패키지\n\n${sources}`);
    files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
    return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
