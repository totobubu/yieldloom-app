// Read-time projection only. Never writes annotations or creates/merges ledger events.
export const CASH_AUTO_RULE_VERSION = 'cash-auto-v2';
const labels = new Map([
    ['이벤트입금', 'reward'],
    ['이벤트 입금', 'reward'],
    ['이자입금', 'interest'],
    ['외화이자입금', 'interest'],
]);
const fxTypes = {
    환전원화입금: ['KRW', 'in'],
    환전외화출금: ['USD', 'out'],
    환전원화출금: ['KRW', 'out'],
    환전외화입금: ['USD', 'in'],
};
const identity = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
const day = (value) => {
    const text = String(value || '')
        .replaceAll('-', '')
        .replaceAll('.', '');
    if (!/^\d{8}$/.test(text)) return null;
    const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
    return Number.isFinite(Date.parse(iso)) &&
        new Date(iso).toISOString().slice(0, 10) === iso
        ? iso
        : null;
};
function decimal(value, places) {
    if (!['number', 'string'].includes(typeof value)) return null;
    const text = String(value);
    if (!/^\d{1,12}(?:\.\d+)?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > places) return null;
    const result =
        BigInt(whole) * 10n ** BigInt(places) +
        BigInt(fraction.padEnd(places, '0') || '0');
    return result > 0n ? result : null;
}

// Only an explicitly bound, source-verified CASH transaction time is eligible.
// Generic observedAt/orderedAt/paidAt, approximate times and date joins are not.
export function verifiedCashTime(entry, accountId = entry?.accountId) {
    const t = entry?.cashTime;
    if (
        !t ||
        t.accountId !== accountId ||
        t.entryId !== entry.id ||
        t.verification !== 'source_verified' ||
        t.role !== 'cash_transaction' ||
        t.timeZone !== 'Asia/Seoul' ||
        !identity(t.sourceId) ||
        !['minute', 'second'].includes(t.precision)
    )
        return null;
    const pattern =
        t.precision === 'minute'
            ? /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d\+09:00$/
            : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\+09:00$/;
    if (
        !pattern.test(t.value || '') ||
        day(t.value.slice(0, 10)) !== day(entry.date)
    )
        return null;
    return {
        value: t.value,
        precision: t.precision,
        timeZone: t.timeZone,
        role: t.role,
        verification: t.verification,
        sourceId: t.sourceId,
        accountId,
        entryId: entry.id,
    };
}
export function verifiedExchangeFee(entry) {
    const fee = entry?.exchangeFee;
    if (
        !(
            fee?.verification === 'source_verified' &&
            fee.entryId === entry.id &&
            fee.accountId === entry.accountId &&
            identity(fee.sourceId) &&
            ['KRW', 'USD'].includes(fee.currency) &&
            /^(?:0|0\.0{1,6})$/.test(String(fee.amount)) &&
            fee.status === 'explicit_zero'
        )
    )
        return null;
    return {
        verification: fee.verification,
        entryId: fee.entryId,
        accountId: fee.accountId,
        sourceId: fee.sourceId,
        currency: fee.currency,
        amount: '0',
        status: fee.status,
    };
}
const key = (e) => `${e.accountId}:${e.id}`;
export function projectAutomaticCashClassifications(state, accountId) {
    const stored =
        state.storedClassifications ??
        (state.classifications || []).filter(
            (row) =>
                !(
                    ['cash-auto-v1', CASH_AUTO_RULE_VERSION].includes(
                        row.origin
                    ) &&
                    row.automatic === true &&
                    row.revision === undefined
                )
        );
    const entries = state.entries || [];
    const protectedIds = new Set(stored.map((row) => row.id)); // Includes deliberate 'unknown' and notes.
    const counts = new Map(),
        externalCounts = new Map();
    for (const e of entries) {
        counts.set(key(e), (counts.get(key(e)) || 0) + 1);
        if (e.externalId)
            externalCounts.set(
                `${e.accountId}:${e.externalId}`,
                (externalCounts.get(`${e.accountId}:${e.externalId}`) || 0) + 1
            );
    }
    const automatic = [],
        diagnostics = [],
        fx = [];
    const eligible = (e) =>
        identity(accountId) &&
        e.accountId === accountId &&
        identity(e.id) &&
        e.source === 'toss-pdf' &&
        !e.voidedAt &&
        !e.purchaseExchange &&
        day(e.date) &&
        ['KRW', 'USD'].includes(e.currency) &&
        decimal(e.amount, e.currency === 'KRW' ? 0 : 6) &&
        counts.get(key(e)) === 1 &&
        (!e.externalId ||
            externalCounts.get(`${accountId}:${e.externalId}`) === 1);
    const add = (e, classification, reason, evidence = {}) =>
        automatic.push({
            id: e.id,
            accountId,
            classification,
            origin: CASH_AUTO_RULE_VERSION,
            automatic: true,
            reason,
            evidence: { rawType: e.rawType, ...evidence },
        });
    for (const e of entries) {
        if (!eligible(e)) continue;
        const rawType = String(e.rawType || '').trim();
        if (labels.has(rawType)) {
            if (
                !protectedIds.has(e.id) &&
                (!e.direction || e.direction === 'in') &&
                (!e.type || e.type === 'cash_in')
            )
                add(e, labels.get(rawType), 'exact_broker_cash_label');
            continue;
        }
        if (!fxTypes[rawType]) continue;
        const [currency, direction] = fxTypes[rawType];
        if (
            currency !== e.currency ||
            (e.direction && e.direction !== direction) ||
            (e.type && e.type !== `cash_${direction}`)
        )
            continue;
        // Server projections run before the client's purchase-link enrichment.
        // A same-day USD buy may consume a forward conversion; without direct
        // settlement evidence it must not be certified as independent FX.
        if (
            ((currency === 'KRW' && direction === 'out') ||
                (currency === 'USD' && direction === 'in')) &&
            (state.trades || []).some(
                (trade) =>
                    (!trade.accountId || trade.accountId === accountId) &&
                    trade.type === 'buy' &&
                    trade.currency === 'USD' &&
                    day(trade.date) === day(e.date)
            )
        ) {
            diagnostics.push({
                id: e.id,
                reason: 'purchase_fx_not_proven_separate',
            });
            continue;
        }
        const time = verifiedCashTime(e, accountId);
        if (
            e.cashTimeUnverified ||
            e.exchangeFeeUnverified ||
            (e.nativeCommission != null && Number(e.nativeCommission) !== 0) ||
            (e.cashTime != null && !time) ||
            (e.exchangeFee != null && !verifiedExchangeFee(e))
        ) {
            diagnostics.push({
                id: e.id,
                reason:
                    e.cashTimeUnverified || (e.cashTime != null && !time)
                        ? 'cash_time_unverified'
                        : 'exchange_fee_unverified',
            });
            continue;
        }
        const rate = decimal(e.exchangeRate, 6);
        if (!rate) continue;
        fx.push({
            e,
            time,
            rate,
            direction,
            protected: protectedIds.has(e.id),
        });
    }
    // A missing/cancelled/duplicate leg must not disappear from the candidate
    // universe and make another pair look uniquely matched.
    const validFxIds = new Set(fx.map(({ e }) => e.id));
    const uncertainDays = new Set(
        entries
            .filter(
                (e) =>
                    e.accountId === accountId &&
                    !e.voidedAt &&
                    /^환전/.test(String(e.rawType || '').trim()) &&
                    !validFxIds.has(e.id)
            )
            .map((e) => `${accountId}:${day(e.date)}`)
    );
    const peers = new Map();
    for (const a of fx) {
        const matches = fx.filter(
            (b) =>
                a !== b &&
                a.e.currency !== b.e.currency &&
                a.direction !== b.direction &&
                day(a.e.date) === day(b.e.date) &&
                (!(a.time && b.time) ||
                    (a.time.value === b.time.value &&
                        a.time.precision === b.time.precision)) &&
                a.rate === b.rate &&
                (() => {
                    const krw = a.e.currency === 'KRW' ? a.e : b.e,
                        usd = a.e.currency === 'USD' ? a.e : b.e;
                    const won = decimal(krw.amount, 0),
                        cents = decimal(usd.amount, 2);
                    return (
                        won !== null &&
                        cents !== null &&
                        won === (cents * a.rate + 50000000n) / 100000000n
                    );
                })()
        );
        peers.set(a.e.id, matches);
    }
    for (const a of fx) {
        if (a.protected) continue;
        if (uncertainDays.has(`${accountId}:${day(a.e.date)}`)) {
            diagnostics.push({ id: a.e.id, reason: 'uncertain_fx_on_day' });
            continue;
        }
        const matches = peers.get(a.e.id);
        if (matches.length !== 1 || peers.get(matches[0].e.id)?.length !== 1) {
            diagnostics.push({
                id: a.e.id,
                reason: 'exchange_pair_ambiguous_or_missing',
            });
            continue;
        }
        const b = matches[0];
        if (b.protected) {
            diagnostics.push({ id: a.e.id, reason: 'manual_peer_annotation' });
            continue;
        }
        const sameVerifiedTime = a.time && b.time;
        add(
            a.e,
            'exchange',
            sameVerifiedTime
                ? 'verified_one_to_one_fx'
                : 'recorded_rate_one_to_one_fx',
            {
                peerId: b.e.id,
                ...(sameVerifiedTime
                    ? {
                          sourceId: a.time.sourceId,
                          peerSourceId: b.time.sourceId,
                          time: a.time.value,
                          precision: a.time.precision,
                          timeZone: a.time.timeZone,
                          timeBasis: 'source_verified',
                      }
                    : { timeBasis: 'not_verified' }),
                exchangeRate: String(a.e.exchangeRate),
                rounding: 'nearest_KRW_half_up',
                fee:
                    verifiedExchangeFee(a.e) && verifiedExchangeFee(b.e)
                        ? 'explicit_zero'
                        : 'not_verified',
            }
        );
    }
    return {
        ...state,
        storedClassifications: stored,
        automaticClassifications: automatic,
        automaticClassificationDiagnostics: diagnostics,
        classifications: [...stored, ...automatic],
    };
}
