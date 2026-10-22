const fail = (message, status = 400, code) => {
    throw Object.assign(new Error(message), { status, code });
};

const rows = (snapshot) =>
    snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));

async function readPortfolioStore(db, root, documentId, warningStage) {
    const assetsSnapshot = await db.collection(`${root}/assets`).get();
    const prefix = `${root}/assets/`;
    let transactionsSnapshot;
    try {
        transactionsSnapshot = await db
            .collectionGroup('transactions')
            .orderBy(documentId)
            .startAt(db.doc(`${root}/assets/\u0001/transactions/\u0001`))
            .endAt(db.doc(`${root}/assets/\uf8ff/transactions/\uf8ff`))
            .get();
    } catch (error) {
        return {
            assets: rows(assetsSnapshot).map((asset) => ({
                ...asset,
                transactions: [],
                ledgerUnavailable: true,
            })),
            warnings: [{ stage: warningStage, code: error.code || 'unknown' }],
            documentReads: assetsSnapshot.docs.length,
            readOperations: 2,
        };
    }
    const byAsset = new Map();
    for (const item of transactionsSnapshot.docs) {
        if (!item.ref.path.startsWith(prefix)) continue;
        const parts = item.ref.path.split('/');
        if (
            parts.length !== 6 ||
            parts[2] !== 'assets' ||
            parts[4] !== 'transactions'
        )
            continue;
        const transaction = { ...item.data(), id: item.id };
        if (!byAsset.has(parts[3])) byAsset.set(parts[3], []);
        byAsset.get(parts[3]).push(transaction);
    }
    return {
        assets: rows(assetsSnapshot).map((asset) => ({
            ...asset,
            transactions: byAsset.has(asset.id)
                ? byAsset.get(asset.id)
                : Array.isArray(asset.transactions)
                  ? asset.transactions
                  : [],
        })),
        warnings: [],
        documentReads:
            assetsSnapshot.docs.length + transactionsSnapshot.docs.length,
        readOperations: 2,
    };
}

export function portfolioDashboardHandler({ verify, database, documentId }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            if (req.method !== 'GET')
                fail('지원하지 않는 요청입니다.', 405, 'METHOD_NOT_ALLOWED');
            const claims = await verify(req);
            const db = database();
            const current = await readPortfolioStore(
                db,
                `portfolios/${claims.uid}`,
                documentId,
                'transactions'
            );
            let assets = current.assets,
                documentReads = current.documentReads,
                readOperations = current.readOperations,
                warnings = current.warnings;
            if (
                !warnings.length &&
                !assets.some((asset) => asset.transactions.length)
            ) {
                try {
                    const legacy = await readPortfolioStore(
                        db,
                        `adminPortfolios/${claims.uid}`,
                        documentId,
                        'legacy'
                    );
                    documentReads += legacy.documentReads;
                    readOperations += legacy.readOperations;
                    if (legacy.warnings.length) {
                        warnings = legacy.warnings;
                        for (const asset of assets)
                            asset.ledgerUnavailable = true;
                    } else {
                        for (const old of legacy.assets) {
                            const active = assets.find(
                                (asset) =>
                                    asset.id === old.id ||
                                    (asset.symbol &&
                                        old.symbol &&
                                        asset.symbol.toUpperCase() ===
                                            old.symbol.toUpperCase())
                            );
                            if (active) active.transactions = old.transactions;
                            else assets.push(old);
                        }
                    }
                } catch (error) {
                    warnings = [
                        { stage: 'legacy', code: error.code || 'unknown' },
                    ];
                    for (const asset of assets) asset.ledgerUnavailable = true;
                }
            }
            res.setHeader('X-Portfolio-Document-Reads', String(documentReads));
            res.setHeader(
                'X-Portfolio-Read-Operations',
                String(readOperations)
            );
            return res.status(200).json({ assets, warnings });
        } catch (error) {
            const exhausted = [8, '8', 'RESOURCE_EXHAUSTED'].includes(
                error.code
            );
            return res.status(exhausted ? 429 : error.status || 500).json({
                code: exhausted ? 'DATA_RESOURCE_EXHAUSTED' : error.code,
                error: exhausted
                    ? '데이터베이스 요청이 제한되었습니다.'
                    : error.message || '포트폴리오를 불러오지 못했습니다.',
            });
        }
    };
}
