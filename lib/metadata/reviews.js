import { createHash } from 'node:crypto';
import { isPortfolioAdmin } from '../portfolio-admin.js';
import { verifiedUnderlying } from '../security-underlyings.js';

const hash = (value) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const symbolPattern = /^[A-Z][A-Z0-9.-]{0,11}$/;
export function reviewDataset(registry, audit, catalog, health = {}) {
    const candidates = new Map(
        Object.values(registry.instruments).map((row) => [row.symbol, row])
    );
    for (const row of audit.unregisteredOfficialProducts ?? [])
        candidates.set(row.symbol, row);
    for (const row of audit.conflicts ?? [])
        if (row.candidate) candidates.set(row.symbol, row.candidate);
    const known = new Map(catalog.map((row) => [row.symbol, row]));
    const auditRows = new Map(
        audit.instruments
            .filter((row) => row.status !== 'no-single-underlying-detected')
            .map((row) => [row.symbol, row])
    );
    const queue = [...new Set([...auditRows.keys(), ...candidates.keys()])]
        .sort()
        .map((symbol) => {
            const row = auditRows.get(symbol),
                candidate = candidates.get(symbol),
                instrument = known.get(symbol);
            const approvedEvidence =
                candidate &&
                verifiedUnderlying(symbol, {
                    schemaVersion: 1,
                    instruments: { [symbol]: candidate },
                });
            return {
                symbol,
                name: instrument?.koName || instrument?.longName || symbol,
                status: instrument
                    ? row?.status || 'needs-review'
                    : 'unregistered',
                currentUnderlying:
                    instrument?.underlying ||
                    row?.legacyUnderlyings?.[0] ||
                    registry.instruments[symbol]?.underlying ||
                    null,
                proposed: approvedEvidence || null,
                nameCandidates: row?.nameCandidates || [],
                registered: Boolean(instrument),
                market: instrument?.market || '',
                currency: instrument?.currency || '',
            };
        });
    return {
        revision: hash({ registry, audit }),
        generatedAt: audit.generatedAt,
        queue,
        health,
        summary: audit.summary,
        sourceFailures: audit.sourceFailures,
    };
}
export function validateDecision(body, dataset) {
    if (body.datasetRevision !== dataset.revision)
        fail('조사 자료가 변경됐습니다. 새로 불러온 뒤 검토해 주세요.', 409);
    const row = dataset.queue.find((item) => item.symbol === body.symbol);
    if (!row || !symbolPattern.test(body.symbol))
        fail('검토할 종목을 확인해 주세요.');
    if (!['approve', 'hold', 'amend', 'reject'].includes(body.action))
        fail('검토 결과를 선택해 주세요.');
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)
        fail('검토 버전을 확인해 주세요.');
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || ''))
        fail('요청 식별자가 올바르지 않습니다.');
    const note = String(body.note || '').trim();
    if (note.length < 8 || note.length > 1000)
        fail('검토 근거를 8~1,000자로 입력해 주세요.');
    let proposedUnderlying = String(
        body.underlying || row.proposed?.underlying || ''
    )
        .trim()
        .toUpperCase();
    if (
        body.action === 'amend' &&
        (!symbolPattern.test(proposedUnderlying) ||
            proposedUnderlying === row.symbol)
    )
        fail('수정할 기초자산 티커를 확인해 주세요.');
    let approved = null,
        instrument = null;
    if (body.action === 'approve') {
        if (
            !row.proposed ||
            (proposedUnderlying &&
                proposedUnderlying !== row.proposed.underlying)
        )
            fail(
                '공식 근거와 일치하는 후보만 승인할 수 있습니다. 수정 제안은 재검증 대상으로 저장해 주세요.'
            );
        approved = row.proposed;
        proposedUnderlying = approved.underlying;
        if (!row.registered) {
            if (
                !['NASDAQ', 'NYSE', 'AMEX', 'BATS', 'NYSEARCA'].includes(
                    body.market
                ) ||
                body.currency !== 'USD'
            )
                fail('신규 종목의 거래소와 USD 통화를 확인해 주세요.');
            const name = String(body.name || '').trim();
            if (
                name.length < 2 ||
                name.length > 200 ||
                body.confirmInstrument !== true
            )
                fail(
                    '공식 자료에서 종목명·거래소·통화를 확인하고 확인란을 선택해 주세요.'
                );
            instrument = {
                symbol: row.symbol,
                market: body.market,
                currency: body.currency,
                longName: name,
                active: true,
                officialProvider: approved.providerName,
            };
        }
    }
    return {
        symbol: row.symbol,
        action: body.action,
        note,
        proposedUnderlying,
        approved,
        instrument,
        status: body.action === 'amend' ? 'needs-verification' : body.action,
        datasetRevision: dataset.revision,
    };
}
export function metadataReviewHandler({
    verify,
    database,
    dataset,
    now = () => new Date().toISOString(),
}) {
    let exported = null,
        expires = 0,
        exporting = null;
    const exportApproved = async () => {
        if (exported && Date.now() < expires) return exported;
        if (!exporting)
            exporting = (async () => {
                const snap = await database()
                    .collection('metadataReviews')
                    .where('action', '==', 'approve')
                    .limit(1000)
                    .get();
                const decisions = snap.docs.map((doc) => {
                    const row = doc.data();
                    return {
                        symbol: row.symbol,
                        revision: row.revision,
                        approved: row.approved,
                        instrument: row.instrument || null,
                    };
                });
                exported = { schemaVersion: 1, decisions };
                expires = Date.now() + 60_000;
                return exported;
            })().finally(() => {
                exporting = null;
            });
        return exporting;
    };
    return async (req, res) => {
        try {
            if (req.method === 'GET' && req.query?.action === 'export') {
                const payload = await exportApproved();
                res.setHeader('Cache-Control', 'public, max-age=30');
                return res.status(200).json(payload);
            }
            res.setHeader('Cache-Control', 'private, no-store');
            const claims = await verify(req, true);
            if (!isPortfolioAdmin(claims))
                fail('관리자만 데이터 검토를 할 수 있습니다.', 403);
            const db = database();
            if (req.method === 'GET') {
                const [reviews, history] = await Promise.all([
                    db.collection('metadataReviews').limit(1000).get(),
                    db
                        .collection('metadataReviewHistory')
                        .orderBy('createdAt', 'desc')
                        .limit(100)
                        .get(),
                ]);
                const visible = (snap) =>
                    snap.docs.map((doc) => {
                        const {
                            actor: _actor,
                            requestHash: _hash,
                            ...value
                        } = doc.data();
                        void _actor;
                        void _hash;
                        return value;
                    });
                return res.status(200).json({
                    ...dataset,
                    reviews: visible(reviews),
                    history: visible(history),
                });
            }
            if (req.method !== 'POST') fail('지원하지 않는 요청입니다.', 405);
            const body = req.body || {},
                decision = validateDecision(body, dataset);
            const requestHash = hash({
                decision,
                expectedRevision: body.expectedRevision,
            });
            const ref = db.collection('metadataReviews').doc(decision.symbol);
            const event = db
                .collection('metadataReviewHistory')
                .doc(body.requestId);
            const result = await db.runTransaction(async (tx) => {
                const [previous, repeated] = await Promise.all([
                    tx.get(ref),
                    tx.get(event),
                ]);
                if (repeated.exists) {
                    const old = repeated.data();
                    if (
                        old.actor !== claims.uid ||
                        old.requestHash !== requestHash
                    )
                        fail('다른 검토에 사용된 요청입니다.', 409);
                    return {
                        symbol: old.symbol,
                        revision: old.revision,
                        status: old.status,
                    };
                }
                const version = previous.exists ? previous.data().revision : 0;
                if (version !== body.expectedRevision)
                    fail(
                        '다른 관리자가 먼저 검토했습니다. 새로 불러와 주세요.',
                        409
                    );
                const value = {
                    ...decision,
                    revision: version + 1,
                    actor: claims.uid,
                    requestHash,
                    createdAt: now(),
                };
                tx.set(ref, value);
                tx.set(event, value);
                return {
                    symbol: decision.symbol,
                    revision: value.revision,
                    status: value.status,
                };
            });
            exported = null;
            expires = 0;
            return res.status(200).json(result);
        } catch (error) {
            return res.status(error.status || 500).json({
                error: error.status
                    ? error.message
                    : '데이터 검토를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            });
        }
    };
}
