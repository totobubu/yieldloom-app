import {
    cashKinds,
    finiteNumber,
    validateFunding,
} from './portfolio-capital.js';

const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const key = (value) => {
    if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value))
        fail('거래 식별자를 확인해 주세요.');
    return value;
};
const revision = (input, snapshot) => {
    if (
        !Number.isInteger(input) ||
        input !== (snapshot.exists ? snapshot.data().revision || 0 : 0)
    )
        fail(
            '다른 화면에서 수정되었습니다. 새로고침 후 다시 확인해 주세요.',
            409
        );
};
const rows = (snapshot) =>
    snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
export function capitalHandler({ verify, database, timestamp }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            const claims = await verify(req);
            const db = database(),
                root = `portfolios/${key(claims.uid)}`;
            if (req.method === 'GET') {
                const [entries, classifications, allocations] =
                    await Promise.all(
                        [
                            'cashEntries',
                            'cashClassifications',
                            'fundingAllocations',
                        ].map((name) => db.collection(`${root}/${name}`).get())
                    );
                return res
                    .status(200)
                    .json({
                        entries: rows(entries),
                        classifications: rows(classifications),
                        allocations: rows(allocations),
                    });
            }
            if (req.method !== 'POST') fail('지원하지 않는 요청입니다.', 405);
            const input = req.body || {};
            if (input.action === 'addCash') {
                const date = String(input.date || '').replaceAll('-', '');
                const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
                if (
                    !/^\d{8}$/.test(date) ||
                    !Number.isFinite(Date.parse(iso)) ||
                    new Date(iso).toISOString().slice(0, 10) !== iso
                )
                    fail('계좌 거래일을 확인해 주세요.');
                if (!['KRW', 'USD'].includes(input.currency))
                    fail('계좌 거래 통화를 선택해 주세요.');
                const amount = finiteNumber(input.amount),
                    exchangeRate = finiteNumber(input.exchangeRate);
                if (
                    !(amount > 0) ||
                    amount > 1e12 ||
                    (input.currency === 'KRW' && !Number.isInteger(amount))
                )
                    fail(
                        '계좌 금액을 확인해 주세요. 원화는 정수로 입력합니다.'
                    );
                if (
                    exchangeRate != null &&
                    (!(exchangeRate > 0) || exchangeRate > 1e6)
                )
                    fail('환율을 확인해 주세요.');
                const note = String(input.note || '').trim();
                if (!note || note.length > 500)
                    fail('계좌 내역을 확인한 근거를 1~500자로 입력해 주세요.');
                if (!Object.hasOwn(cashKinds, input.classification))
                    fail('계좌 거래 구분을 선택해 주세요.');
                const id = key(input.id),
                    entry = db.doc(`${root}/cashEntries/${id}`),
                    classification = db.doc(
                        `${root}/cashClassifications/${id}`
                    );
                await db.runTransaction(async (tx) => {
                    const previous = await tx.get(entry);
                    if (previous.exists) return; // Idempotent retry using the browser-generated ID.
                    tx.set(entry, {
                        date,
                        currency: input.currency,
                        amount,
                        exchangeRate,
                        rawType: '사용자 입력',
                        suggestedKind: input.classification,
                        source: 'manual',
                        createdAt: timestamp(),
                    });
                    tx.set(classification, {
                        classification: input.classification,
                        note,
                        revision: 1,
                        updatedAt: timestamp(),
                    });
                });
                return res.status(200).json({ id });
            }
            if (input.action === 'classifyCash') {
                const id = key(input.id),
                    ref = db.doc(`${root}/cashClassifications/${id}`);
                if (!Object.hasOwn(cashKinds, input.classification))
                    fail('계좌 거래 구분을 선택해 주세요.');
                const note = String(input.note || '').trim();
                if (note.length > 500)
                    fail('메모는 500자 이하로 입력해 주세요.');
                await db.runTransaction(async (tx) => {
                    const [entry, previous] = await Promise.all([
                        tx.get(db.doc(`${root}/cashEntries/${id}`)),
                        tx.get(ref),
                    ]);
                    if (!entry.exists)
                        fail('계좌 내역을 찾을 수 없습니다.', 404);
                    revision(input.revision, previous);
                    tx.set(ref, {
                        classification: input.classification,
                        note,
                        revision: input.revision + 1,
                        updatedAt: timestamp(),
                    });
                });
                return res.status(200).json({ id });
            }
            if (
                input.action === 'saveFunding' ||
                input.action === 'resetFunding'
            ) {
                const assetId = key(input.assetId),
                    transactionId = key(input.transactionId),
                    id = `${assetId}.${transactionId}`; // IDs cannot contain dots, so the pair is unambiguous.
                const ref = db.doc(`${root}/fundingAllocations/${id}`);
                await db.runTransaction(async (tx) => {
                    const tradeRef = db.doc(
                        `${root}/assets/${assetId}/transactions/${transactionId}`
                    );
                    const [trade, previous] = await Promise.all([
                        tx.get(tradeRef),
                        tx.get(ref),
                    ]);
                    if (!trade.exists)
                        fail('본인 원장의 거래를 찾을 수 없습니다.', 404);
                    revision(input.revision, previous);
                    if (input.action === 'resetFunding') {
                        tx.set(ref, {
                            assetId,
                            transactionId,
                            status: 'reset',
                            revision: input.revision + 1,
                            updatedAt: timestamp(),
                        });
                        return;
                    }
                    const allocation = validateFunding(input, trade.data());
                    for (const evidenceId of allocation.evidenceIds) {
                        if (
                            !(
                                await tx.get(
                                    db.doc(`${root}/cashEntries/${evidenceId}`)
                                )
                            ).exists
                        )
                            fail('본인 계좌 내역만 근거로 선택할 수 있습니다.');
                    }
                    tx.set(ref, {
                        ...allocation,
                        assetId,
                        transactionId,
                        revision: input.revision + 1,
                        updatedAt: timestamp(),
                    });
                });
                return res.status(200).json({ id });
            }
            fail('지원하지 않는 작업입니다.');
        } catch (error) {
            const status =
                error.status ||
                (String(error.code || '').startsWith('auth/') ? 401 : 500);
            return res
                .status(status)
                .json({
                    error:
                        status < 500
                            ? error.message
                            : '원금 내역을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
                });
        }
    };
}
