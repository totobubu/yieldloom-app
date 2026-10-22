import { createHash } from 'node:crypto';

const origins = [
    'https://totobubu.github.io',
    'https://yieldloom-app.vercel.app',
];

async function verify() {
    const base = (
        process.env.PUBLIC_RELEASE_BASE_URL ||
        process.env.VITE_R2_PUBLIC_URL ||
        ''
    ).replace(/\/+$/, '');
    const expected = process.env.EXPECTED_RELEASE_ID;
    if (
        !base.startsWith('https://') ||
        !/^[A-Za-z0-9._-]+$/.test(expected || '')
    )
        throw new Error(
            'Public HTTPS root and expected release ID are required'
        );

    async function read(key, digest) {
        let bytes;
        for (const origin of origins) {
            const response = await fetch(`${base}/${key}`, {
                headers: { Origin: origin, 'Cache-Control': 'no-cache' },
                signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}: ${key}`);
            if (
                ![origin, '*'].includes(
                    response.headers.get('access-control-allow-origin')
                )
            )
                throw new Error(
                    `Browser CORS missing for ${key} from ${origin}`
                );
            const raw = Buffer.from(await response.arrayBuffer());
            if (
                digest &&
                createHash('sha256').update(raw).digest('hex') !== digest
            )
                throw new Error(`Hash mismatch: ${key}`);
            if (bytes && !bytes.equals(raw))
                throw new Error(`Origins returned different data: ${key}`);
            bytes = raw;
        }
        return JSON.parse(bytes.toString('utf8'));
    }

    const pointer = await read('core/current.json');
    const manifestKey = `core/releases/${expected}/manifest.json`;
    if (pointer.releaseId !== expected || pointer.manifestKey !== manifestKey)
        throw new Error('Published pointer does not match expected release');
    const manifest = await read(manifestKey);
    if (manifest.releaseId !== expected || manifest.schemaVersion !== 2)
        throw new Error('Manifest release identity mismatch');
    const hashes = new Map(manifest.files.map((row) => [row.path, row.sha256]));
    const root = manifestKey.slice(0, -'manifest.json'.length);
    async function asset(key) {
        const digest = hashes.get(key);
        if (!/^[a-f0-9]{64}$/.test(digest || ''))
            throw new Error(`Manifest missing hash: ${key}`);
        return read(root + key, digest);
    }
    const index = await asset('index.json');
    const catalog = await asset('catalog/search-index.json');
    const ticker = index.tickers[0];
    const history = await asset(ticker.historyPath);
    if (
        history.ticker !== ticker.ticker ||
        history.events.length !== ticker.historyCount
    )
        throw new Error('Ticker history identity or count mismatch');
    console.log(
        '::notice title=Public core release verified::' +
            JSON.stringify({
                releaseId: expected,
                tickers: index.tickers.length,
                instruments: catalog.instruments.length,
                sampleTicker: history.ticker,
                sampleEvents: history.events.length,
                hashes: 'verified',
                corsOrigins: origins,
            })
    );
}

verify().catch((error) => {
    const message = String(error.message)
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
    console.error(`::error title=Public core release probe::${message}`);
    process.exitCode = 1;
});
