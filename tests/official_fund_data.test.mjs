import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialFundClient } from '../src/services/officialFundData.js';
import { createPublicJsonClient } from '../src/services/publicJson.js';

test('disabled official fund consumer makes no requests', async () => {
    const load = createOfficialFundClient({
        baseUrl: '',
        read: () => assert.fail('Unexpected request'),
    });
    assert.equal(await load('IVV'), null);
});

test('concurrent fund reads share 3 requests and holdings remain lazy', async () => {
    const calls = [];
    const entity = 'instrument:isin:US4642872000';
    const path = `entities/${'a'.repeat(64)}.json`;
    let releaseId = 'one';
    const read = createPublicJsonClient({
        fetcher: async (url) => {
            calls.push(url);
            const dataset = url.includes('/holdings/')
                ? 'holdings'
                : 'fund-observations';
            return Response.json(
                url.endsWith('/current.json')
                    ? {
                          schemaVersion: 1,
                          dataset,
                          releaseId,
                          manifestKey: `datasets/${dataset}/releases/${releaseId}/manifest.json`,
                      }
                    : url.endsWith('/manifest.json')
                      ? {
                            schemaVersion: 1,
                            dataset,
                            releaseId,
                            entities: { [entity]: { path } },
                            symbols: { IVV: entity },
                            policies: {},
                        }
                      : {
                            schemaVersion: 1,
                            dataset,
                            releaseId,
                            entityId: entity,
                            observations: [
                                {
                                    entityId: entity,
                                    dataset,
                                    field: 'nav',
                                    value: '100.0000',
                                    asOfDate: '2026-10-21',
                                    sourceUrl: 'https://example.com',
                                },
                            ],
                        }
            );
        },
    });
    const load = createOfficialFundClient({
        baseUrl: 'https://data.test',
        read,
    });
    const [a, b] = await Promise.all([load('IVV'), load('IVV')]);
    assert.equal(calls.length, 3);
    assert.equal(a.observations[0].value, '100.0000');
    b.observations[0].value = 'changed';
    assert.equal((await load('IVV')).observations[0].value, '100.0000');
    assert.equal(calls.length, 3);
    await load('IVV', 'holdings');
    assert.equal(calls.length, 6);
    releaseId = 'two';
    await load('IVV', 'fund-observations', { force: true });
    assert.equal(calls.length, 9);
    assert.ok(calls.at(-1).includes('/two/'));
});

test('malicious manifest path is rejected before entity request', async () => {
    let count = 0;
    const read = createPublicJsonClient({
        fetcher: async () =>
            Response.json(
                ++count === 1
                    ? {
                          schemaVersion: 1,
                          dataset: 'holdings',
                          releaseId: 'one',
                          manifestKey:
                              'datasets/holdings/releases/one/manifest.json',
                      }
                    : {
                          schemaVersion: 1,
                          dataset: 'holdings',
                          releaseId: 'one',
                          symbols: { IVV: 'fund' },
                          entities: { fund: { path: '../../private.json' } },
                          policies: {},
                      }
            ),
    });
    const load = createOfficialFundClient({
        baseUrl: 'https://data.test',
        read,
    });
    await assert.rejects(load('IVV', 'holdings'), /경로/);
    assert.equal(count, 2);
});
