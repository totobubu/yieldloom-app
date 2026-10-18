import { isPortfolioAdmin } from './portfolio-admin.js';
import { lookupIsin } from './isin-lookup.js';

const fail = (message, status = 400) => {
    const error = new Error(message);
    error.status = status;
    throw error;
};
const isinPattern = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const sourceIsin = (snapshot) =>
    String(snapshot.data().isin || snapshot.id).toUpperCase();
export function validateMapping(input, catalog) {
    const isin = String(input.isin || '')
        .trim()
        .toUpperCase();
    const symbol = String(input.symbol || '')
        .trim()
        .toUpperCase();
    if (!isinPattern.test(isin)) fail('PDF의 12자리 ISIN을 확인해 주세요.');
    if (!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(symbol))
        fail('연결할 티커를 확인해 주세요.');
    const entry = catalog.find((row) => row.symbol === symbol);
    const name = entry?.koName || String(input.name || '').trim();
    const canonicalIsin = String(
        entry?.isin || input.canonicalIsin || isin
    ).toUpperCase();
    const evidence = String(input.evidence || '').trim();
    if (!name || name.length > 200) fail('종목명을 입력해 주세요.');
    if (!isinPattern.test(canonicalIsin))
        fail('연결할 종목의 ISIN을 확인해 주세요.');
    if (evidence.length < 8 || evidence.length > 1000)
        fail('종목을 확인한 근거를 8~1,000자로 입력해 주세요.');
    return {
        isin,
        symbol,
        canonicalIsin,
        koName: name,
        evidence,
        catalogMatched: Boolean(entry),
    };
}

async function activeAssets(db) {
    const all = await db.collectionGroup('assets').get();
    return all.docs.filter((doc) => {
        const parts = doc.ref.path.split('/');
        return parts.length === 4 && parts[0] === 'portfolios';
    });
}

export function mappingHandler({
    verify,
    database,
    catalog,
    timestamp,
    lookup = lookupIsin,
    now = () => Date.now(),
}) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            const claims = await verify(req);
            if (!isPortfolioAdmin(claims))
                fail('관리자만 종목 연결을 관리할 수 있습니다.', 403);
            if (!['GET', 'POST'].includes(req.method))
                fail('지원하지 않는 요청입니다.', 405);
            const db = database();
            if (req.method === 'GET') {
                const assets = await activeAssets(db);
                const groups = new Map();
                for (const asset of assets) {
                    const data = asset.data(),
                        isin = sourceIsin(asset);
                    if (data.symbol || !isinPattern.test(isin)) continue;
                    if (!groups.has(isin))
                        groups.set(isin, { isin, names: [], assetCount: 0 });
                    const group = groups.get(isin);
                    if (data.name && !group.names.includes(data.name))
                        group.names.push(data.name);
                    group.assetCount += 1;
                }
                const discovered = await db
                    .collection('portfolioIsinCandidates')
                    .where('status', '==', 'pending')
                    .limit(200)
                    .get();
                for (const candidate of discovered.docs) {
                    if (!isinPattern.test(candidate.id)) continue;
                    if (!groups.has(candidate.id))
                        groups.set(candidate.id, {
                            isin: candidate.id,
                            names: [],
                            assetCount: 0,
                        });
                    const group = groups.get(candidate.id);
                    group.names = [
                        ...new Set([
                            ...group.names,
                            ...(candidate.data().names || []),
                        ]),
                    ].slice(0, 10);
                    group.discoveredInUploads = true;
                }
                const reviewed = await db
                    .collection('portfolioSecurityMappings')
                    .orderBy('reviewedAt', 'desc')
                    .limit(50)
                    .get();
                return res.status(200).json({
                    pending: [...groups.values()],
                    reviewed: reviewed.docs.map((doc) => ({
                        isin: doc.id,
                        ...doc.data(),
                        reviewedBy: undefined,
                    })),
                    catalog: catalog.map(({ symbol, isin, koName }) => ({
                        symbol,
                        isin,
                        name: koName || symbol,
                    })),
                });
            }
            const body = req.body || {};
            if (body.action === 'lookup')
                return res.status(200).json(await lookup(body.isin));
            if (body.action === 'preview') {
                let mapping;
                if (body.autoLookup === true) {
                    const result = await lookup(body.isin);
                    const candidate = result.candidates.find(
                        (row) => row.symbol === body.symbol && row.crossChecked
                    );
                    if (!candidate)
                        fail(
                            '자동 조회 결과가 일치하지 않습니다. 후보를 다시 확인해 주세요.',
                            409
                        );
                    const entry = catalog.find(
                        (row) => row.symbol === candidate.symbol
                    );
                    mapping = {
                        ...validateMapping(
                            {
                                ...body,
                                name: entry?.koName || candidate.name,
                                canonicalIsin: result.isin,
                                evidence: `OpenFIGI의 ISIN 일치 결과와 Yahoo Finance의 ISIN 검색 결과가 ${candidate.symbol}로 일치함. ${candidate.sources.map((source) => source.url).join(' ')}`,
                            },
                            []
                        ),
                        verifiedByLookup: true,
                        figi: candidate.figi || null,
                        compositeFigi: candidate.compositeFigi || null,
                        shareClassFigi: candidate.shareClassFigi || null,
                        lookupSources: candidate.sources,
                        catalogMatched: Boolean(entry),
                    };
                } else mapping = validateMapping(body, catalog);
                const assets = (await activeAssets(db)).filter(
                    (asset) => sourceIsin(asset) === mapping.isin
                );
                if (
                    mapping.verifiedByLookup &&
                    !mapping.catalogMatched &&
                    assets[0]?.data().name
                ) {
                    mapping.koName = assets[0].data().name;
                }
                if (assets.length > 400)
                    fail('대상 원장이 너무 많아 일괄 연결할 수 없습니다.', 409);
                const previousMapping = await db
                    .collection('portfolioSecurityMappings')
                    .doc(mapping.isin)
                    .get();
                const review = db.collection('portfolioMappingReviews').doc();
                await review.set({
                    ownerUid: claims.uid,
                    mapping,
                    expiresAt: now() + 30 * 60 * 1000,
                    previousMappingVersion:
                        previousMapping.updateTime?.toMillis() ?? null,
                    assets: assets.map((asset) => ({
                        path: asset.ref.path,
                        previousSymbol: asset.data().symbol || null,
                    })),
                });
                return res.status(200).json({
                    reviewId: review.id,
                    mapping,
                    affectedAssets: assets.length,
                    names: [
                        ...new Set(
                            assets
                                .map((asset) => asset.data().name)
                                .filter(Boolean)
                        ),
                    ],
                    replacesExistingSymbols: assets.some(
                        (asset) =>
                            asset.data().symbol &&
                            asset.data().symbol !== mapping.symbol
                    ),
                });
            }
            if (
                body.action !== 'apply' ||
                !/^[A-Za-z0-9]{1,100}$/.test(body.reviewId || '')
            )
                fail('연결 검토를 먼저 진행해 주세요.');
            const reviewRef = db
                .collection('portfolioMappingReviews')
                .doc(body.reviewId);
            const result = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(reviewRef);
                const review = snapshot.data();
                if (!review || review.ownerUid !== claims.uid)
                    fail('이 연결 검토에 접근할 수 없습니다.', 403);
                if (review.result) return review.result;
                if (review.expiresAt < now())
                    fail(
                        '연결 검토가 만료되었습니다. 다시 확인해 주세요.',
                        410
                    );
                const mappingRef = db
                    .collection('portfolioSecurityMappings')
                    .doc(review.mapping.isin);
                const previousMapping = await transaction.get(mappingRef);
                if (
                    (previousMapping.updateTime?.toMillis() ?? null) !==
                    review.previousMappingVersion
                ) {
                    fail(
                        '검토 이후 ISIN 연결이 바뀌었습니다. 다시 검토해 주세요.',
                        409
                    );
                }
                const refs = review.assets.map((asset) => db.doc(asset.path));
                const documents = refs.length
                    ? await transaction.getAll(...refs)
                    : [];
                for (let index = 0; index < documents.length; index += 1) {
                    const asset = documents[index];
                    if (
                        !asset.exists ||
                        sourceIsin(asset) !== review.mapping.isin ||
                        (asset.data().symbol || null) !==
                            review.assets[index].previousSymbol
                    ) {
                        fail(
                            '검토 이후 종목 정보가 바뀌었습니다. 다시 검토해 주세요.',
                            409
                        );
                    }
                }
                const { mapping } = review;
                const record = {
                    ...mapping,
                    reviewedAt: timestamp(),
                    reviewedBy: claims.uid,
                };
                transaction.set(
                    db
                        .collection('portfolioSecurityMappings')
                        .doc(mapping.isin),
                    record
                );
                for (const ref of refs)
                    transaction.update(ref, {
                        symbol: mapping.symbol,
                        name: mapping.koName,
                        canonicalIsin: mapping.canonicalIsin,
                        mappingSourceIsin: mapping.isin,
                        portfolioCatalogMatched: mapping.catalogMatched,
                        figi: mapping.figi || null,
                        compositeFigi: mapping.compositeFigi || null,
                        shareClassFigi: mapping.shareClassFigi || null,
                        mappingReviewedAt: timestamp(),
                    });
                transaction.set(
                    db.collection('portfolioIsinCandidates').doc(mapping.isin),
                    {
                        status: 'resolved',
                        symbol: mapping.symbol,
                        resolvedAt: timestamp(),
                    },
                    { merge: true }
                );
                transaction.set(
                    db.collection('portfolioMappingAudit').doc(body.reviewId),
                    { ...record, affectedAssets: refs.length }
                );
                const result = {
                    updatedAssets: refs.length,
                    isin: mapping.isin,
                    symbol: mapping.symbol,
                };
                transaction.update(reviewRef, {
                    result,
                    appliedAt: timestamp(),
                });
                return result;
            });
            return res.status(200).json(result);
        } catch (error) {
            const status =
                error.status ||
                (String(error.code || '').startsWith('auth/') ? 401 : 500);
            return res.status(status).json({
                error:
                    status === 500
                        ? '종목 연결을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
                        : error.message,
            });
        }
    };
}
