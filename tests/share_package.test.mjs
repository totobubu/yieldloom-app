import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { createPublishPackage } from '../src/services/thumbnail/publishPackage.js';
import { createCardShareText } from '../src/services/thumbnail/shareText.js';

test('comparison copy preserves decreases, increases, zero and unknown amounts', () => {
    const copy = (dividendDifference) =>
        createCardShareText('comparison', {
            symbol: 'TEST',
            dividendDifference,
        });
    assert.match(copy(-0.1), /배당 -\$0\.1/);
    assert.match(copy(0.1), /배당 \+\$0\.1/);
    assert.match(copy(0), /변동 없음 \(\$0\)/);
    assert.match(copy(null), /비교 데이터 준비 중/);
    assert.match(copy(NaN), /비교 데이터 준비 중/);
    assert.doesNotMatch(copy(0), /확정 배당 정보 없음/);
});

test('card copy is specific to the requested card and surfaces stale data', () => {
    const data = {
        symbol: 'TSLY',
        hasDividend: true,
        currentDividendAmount: 0.12,
        exDate: '2026-10-10',
        dividendDifference: 0.01,
    };
    assert.match(
        createCardShareText('calendar', data, { sourceStatus: 'stale' }),
        /다음 배당 일정/
    );
    assert.match(
        createCardShareText('calendar', data, { sourceStatus: 'stale' }),
        /갱신 지연/
    );
    assert.notEqual(
        createCardShareText('summary', data),
        createCardShareText('entry-efficiency', data)
    );
});

test('publish package includes card image, card copy, sources, and manifest', async () => {
    const blob = createPublishPackage({
        symbol: 'TSLY',
        tone: 'informative',
        sourceStatus: 'fresh',
        cards: [
            {
                kind: 'summary',
                label: '요약',
                filename: 'tsly_summary.png',
                png: new Uint8Array([1, 2, 3]),
                text: 'TSLY copy',
                sourceUrl: '/source.json',
                asOfDate: '2026-10-10',
            },
        ],
    });
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    assert.deepEqual(Object.keys(files).sort(), [
        'manifest.json',
        'sources.md',
        'tsly_summary.png',
        'tsly_summary.txt',
    ]);
    assert.match(strFromU8(files['sources.md']), /기준일: 2026-10-10/);
    assert.equal(
        JSON.parse(strFromU8(files['manifest.json'])).cards[0].kind,
        'summary'
    );
    assert.deepEqual(
        JSON.parse(strFromU8(files['manifest.json'])).presentation,
        { aspectRatio: 'square', template: 'classic', width: 720, height: 720 }
    );
});

test('non-square package filenames and manifest describe the selected output', async () => {
    const presentation = { aspectRatio: 'story', template: 'navy' };
    const blob = createPublishPackage({
        symbol: 'TSLY',
        tone: 'concise',
        sourceStatus: 'stale',
        presentation,
        cards: [
            {
                kind: 'summary',
                label: '요약',
                filename: 'tsly_summary_story_navy.png',
                png: new Uint8Array([1]),
                text: '공개 배당 정보',
                sourceUrl: '/official.json',
                asOfDate: '2026-10-15',
            },
        ],
    });
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    assert.ok(files['tsly_summary_story_navy.png']);
    assert.equal(
        strFromU8(files['tsly_summary_story_navy.txt']),
        '공개 배당 정보'
    );
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.equal(manifest.schemaVersion, 2);
    assert.deepEqual(manifest.presentation, {
        ...presentation,
        width: 720,
        height: 1280,
    });
    assert.equal(manifest.dataStatus, 'stale');
});
