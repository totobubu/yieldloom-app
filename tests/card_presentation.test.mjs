import test from 'node:test';
import assert from 'node:assert/strict';
import {
    artworkFilename,
    cardDimensions,
    normalizeCardPresentation,
} from '../src/services/thumbnail/cardPresentation.js';
import {
    loadLocalPresets,
    removeLocalPreset,
    saveLocalPreset,
} from '../src/services/contentPresets.js';

test('default filenames and dimensions stay compatible while unknown presentation values fall back safely', () => {
    assert.deepEqual(cardDimensions(), { width: 720, height: 720 });
    assert.equal(artworkFilename('TSLY', 'summary'), 'tsly_summary.png');
    assert.deepEqual(cardDimensions({ aspectRatio: 'wide' }), {
        width: 1280,
        height: 720,
    });
    assert.deepEqual(cardDimensions({ aspectRatio: 'story' }), {
        width: 720,
        height: 1280,
    });
    assert.equal(
        artworkFilename('TSLY', 'calendar', {
            aspectRatio: 'wide',
            template: 'paper',
        }),
        'tsly_calendar_wide_paper.png'
    );
    assert.deepEqual(
        normalizeCardPresentation({
            aspectRatio: '../../',
            template: 'unknown',
        }),
        { aspectRatio: 'square', template: 'classic' }
    );
    assert.throws(() => artworkFilename('TSLY', '../../private'));
});

test('v1 presets retain ticker/rivals/tone and migrate to square classic without losing their ids', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'localStorage'
    );
    const values = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        },
    });
    const key = 'yieldloom.thumbnail-presets.v1';
    try {
        values.set(
            key,
            JSON.stringify([
                {
                    id: 'old',
                    name: '기존 프리셋',
                    ticker: 'tsly',
                    rivals: ['CRSH'],
                    tone: 'friendly',
                },
            ])
        );
        const [legacy] = loadLocalPresets();
        assert.equal(legacy.id, 'old');
        assert.equal(legacy.ticker, 'TSLY');
        assert.deepEqual(legacy.rivals, ['CRSH']);
        assert.equal(legacy.tone, 'friendly');
        assert.deepEqual(legacy.presentation, {
            aspectRatio: 'square',
            template: 'classic',
        });
        assert.deepEqual(legacy.cardKinds, ['summary']);
        const item = saveLocalPreset({
            ...legacy,
            id: 'new',
            presentation: { aspectRatio: 'story', template: 'navy' },
            cardKinds: ['summary', 'calendar', 'calendar', 'unknown'],
        });
        assert.equal(item.schemaVersion, 2);
        assert.deepEqual(
            loadLocalPresets().find((entry) => entry.id === 'new').presentation,
            item.presentation
        );
        assert.deepEqual(item.cardKinds, ['summary', 'calendar']);
        removeLocalPreset('old');
        assert.deepEqual(
            loadLocalPresets().map((entry) => entry.id),
            ['new']
        );
        for (const bad of [
            'null',
            '{}',
            '[null,"bad",{"id":"x","ticker":"../../private"}]',
            'broken-json',
        ]) {
            values.set(key, bad);
            assert.deepEqual(loadLocalPresets(), []);
        }
    } finally {
        if (descriptor)
            Object.defineProperty(globalThis, 'localStorage', descriptor);
        else delete globalThis.localStorage;
    }
});
