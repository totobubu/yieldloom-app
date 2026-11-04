import { createHash } from 'node:crypto';
export const sha = (text) => createHash('sha256').update(text).digest('hex');
export function fixture(version = 1) {
    const releaseId = String(version).repeat(64);
    const event = {
        ticker: 'BAC',
        distribution_per_share: '0.32',
        currency: 'USD',
        ex_date: '2026-09-04',
        declared_date: '2026-08-01',
        verification_status: 'official',
        official_url: 'https://issuer.example/dividend',
    };
    const history = [
        event,
        ...(version === 2
            ? [
                  {
                      ...event,
                      distribution_per_share: '0.33',
                      ex_date: '2026-12-04',
                  },
              ]
            : []),
    ];
    const stock = {
        schemaVersion: 1,
        symbol: 'BAC',
        currency: 'USD',
        candles: [],
        announcements: [],
        history:
            version === 2
                ? [
                      {
                          ticker: 'BAC',
                          ex_date: '2026-11-04',
                          distribution_per_share: '0.01',
                          currency: 'USD',
                          verification_status: 'needs_review',
                          source_class: 'public_aggregator',
                      },
                  ]
                : [],
    };
    const payloads = {
        'distribution-index.json': {
            providers: [],
            tickers: [
                {
                    ticker: 'BAC',
                    latest: history.at(-1),
                    historyUrl: '/content-studio/distribution-ticker-bac.json',
                },
            ],
        },
        'distribution-ticker-bac.json': { ticker: 'BAC', history },
        'stock-evidence-index.json': {
            schemaVersion: 1,
            tickers: [
                {
                    ticker: 'BAC',
                    historyUrl: '/content-studio/stock-evidence-bac.json',
                },
            ],
        },
        'stock-evidence-bac.json': stock,
        'price-index.json': { prices: {} },
    };
    const files = {},
        objects = {};
    for (const [name, value] of Object.entries(payloads)) {
        const body = JSON.stringify(value),
            hash = sha(body);
        files[name] = { sha256: hash };
        objects[`objects/${hash}.json`] = body;
    }
    return {
        releaseId,
        objects,
        manifest: JSON.stringify({ schemaVersion: 1, releaseId, files }),
    };
}
export function storage() {
    let active = fixture(1);
    const versions = new Map([[active.releaseId, active]]),
        requests = [];
    const read = (url) => {
        const path =
            url.split('/public-content/production/')[1] ||
            url.split('/public-content/preview-aaaaaaaaaaaaaaaa/')[1];
        requests.push(path);
        if (path === 'current.json')
            return JSON.stringify({
                schemaVersion: 1,
                releaseId: active.releaseId,
            });
        for (const version of versions.values()) {
            if (path === `releases/${version.releaseId}/manifest.json`)
                return version.manifest;
            if (version.objects[path]) return version.objects[path];
        }
        return null;
    };
    return {
        requests,
        read,
        advance: () => {
            active = fixture(2);
            versions.set(active.releaseId, active);
        },
        rollback: () => {
            active = versions.values().next().value;
        },
    };
}
