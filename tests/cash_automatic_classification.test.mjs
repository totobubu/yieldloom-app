import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    projectAutomaticCashClassifications as project,
    verifiedCashTime,
    verifiedExchangeFee,
} from '../lib/cash-automatic-classification.js';
import { capitalSummary } from '../lib/portfolio-capital.js';
import { tracePortfolioFunding } from '../src/services/portfolioFundingTrace.js';
const scope = 'synthetic-A';
const row = (id, rawType, currency, amount) => ({
    id,
    accountId: scope,
    date: '2026-10-17',
    source: 'toss-pdf',
    rawType,
    currency,
    amount,
    exchangeRate: '1334.13',
});
function pair(reverse = true) {
    return [
        row('krw', reverse ? '환전원화입금' : '환전원화출금', 'KRW', '90908'),
        row('usd', reverse ? '환전외화출금' : '환전외화입금', 'USD', '68.14'),
    ].map((e) => ({
        ...e,
        cashTime: {
            accountId: scope,
            entryId: e.id,
            sourceId: 'synthetic-source',
            value: '2026-10-17T12:34+09:00',
            precision: 'minute',
            role: 'cash_transaction',
            timeZone: 'Asia/Seoul',
            verification: 'source_verified',
        },
        exchangeFee: {
            accountId: scope,
            entryId: e.id,
            sourceId: 'synthetic-source',
            verification: 'source_verified',
            status: 'explicit_zero',
            amount: '0',
            currency: e.currency,
        },
    }));
}
const state = (entries, classifications = []) => ({
    entries,
    classifications,
    trades: [],
    allocations: [],
});
test('exact event and interest labels classify existing rows without writes, dates or inferred synonyms', () => {
    const source = state(
        [
            '이벤트입금',
            '이벤트 입금',
            '이자입금',
            '외화이자입금',
            '외환이자입금',
            '외화이자세금출금',
            '이자입금취소',
            '이벤트입금반환',
            '이자 입금',
        ].map((name, i) => row('row' + i, name, 'KRW', 100))
    );
    const original = structuredClone(source),
        out = project(source, scope);
    assert.deepEqual(
        out.automaticClassifications.map((x) => x.classification),
        ['reward', 'reward', 'interest', 'interest']
    );
    assert.deepEqual(source, original);
    assert.equal(out.storedClassifications.length, 0);
    assert.equal(
        capitalSummary(out.entries, out.classifications).KRW.deposits,
        0
    );
    const traced = tracePortfolioFunding(out).currencies.find(
        (x) => x.currency === 'KRW'
    );
    assert.equal(traced.deposits, 0);
    assert.equal(traced.principalRecovered, 0);
});
test('both FX directions require source-bound same actual time and exact integer rounding', () => {
    for (const reverse of [true, false]) {
        const input = state(pair(reverse)),
            out = project(input, scope);
        assert.equal(out.automaticClassifications.length, 2);
        assert(
            out.automaticClassifications.every(
                (x) => x.classification === 'exchange'
            )
        );
        assert.equal(out.automaticClassifications[0].evidence.peerId, 'usd');
        assert.deepEqual(
            capitalSummary(input.entries, []).KRW,
            capitalSummary(out.entries, out.classifications).KRW
        );
        assert.equal(
            capitalSummary(out.entries, out.classifications).pending,
            0
        );
    }
});
test('no fabricated time: missing, unverified, wrong role, binding, timezone, precision or near-only times stay pending', () => {
    const changes = [
        undefined,
        { verification: 'candidate' },
        { role: 'ordered' },
        { entryId: 'other' },
        { accountId: 'other' },
        { timeZone: 'UTC' },
        { value: '2026-10-17T12:35+09:00' },
        { precision: 'second', value: '2026-10-17T12:34:01+09:00' },
        { value: '2026-10-17T24:00+09:00' },
        { value: '2026-10-18T12:34+09:00' },
    ];
    for (const patch of changes) {
        const rows = pair();
        rows[1].cashTime =
            patch === undefined ? undefined : { ...rows[1].cashTime, ...patch };
        rows[1].timestamp = '2026-10-17 12:34';
        assert.equal(
            project(state(rows), scope).automaticClassifications.length,
            0
        );
    }
});
test('rate, amount, currency, direction, ownership, fee, settlement FX and cancellation checks fail closed', () => {
    for (const patch of [
        { exchangeRate: '1334.14' },
        { amount: '68.15' },
        { currency: 'KRW' },
        { direction: 'in' },
        { accountId: 'other' },
        { source: 'manual' },
        { purchaseExchange: true },
        { exchangeFee: undefined },
        { rawType: '환전외화출금취소' },
        { rawType: '외화출금' },
    ]) {
        const rows = pair();
        Object.assign(rows[1], patch);
        assert.equal(
            project(state(rows), scope).automaticClassifications.length,
            0
        );
    }
    for (const amount of ['1', '0.01']) {
        const rows = pair();
        rows[1].exchangeFee.amount = amount;
        assert.equal(
            project(state(rows), scope).automaticClassifications.length,
            0
        );
    }
    assert.equal(project(state(pair()), '').automaticClassifications.length, 0);
});
test('all candidates participate: duplicate IDs, many equal pairs and incomplete third legs cannot appear unique', () => {
    const rows = pair(),
        additional = pair().map((e) => ({
            ...e,
            id: e.id + '2',
            cashTime: { ...e.cashTime, entryId: e.id + '2' },
            exchangeFee: { ...e.exchangeFee, entryId: e.id + '2' },
        }));
    assert.equal(
        project(state([...rows, ...additional]), scope).automaticClassifications
            .length,
        0
    );
    assert.equal(
        project(state([...rows, { ...rows[1] }]), scope)
            .automaticClassifications.length,
        0
    );
    assert.equal(
        project(
            state([...rows, { ...additional[1], cashTime: undefined }]),
            scope
        ).automaticClassifications.length,
        0
    );
    for (const patch of [
        { exchangeRate: 0 },
        { direction: 'in' },
        { currency: 'KRW' },
    ]) {
        assert.equal(
            project(state([...rows, { ...additional[1], ...patch }]), scope)
                .automaticClassifications.length,
            0
        );
    }
    const duplicateExternal = pair().map((e) => ({ ...e, externalId: 'same' }));
    assert.equal(
        project(state(duplicateExternal), scope).automaticClassifications
            .length,
        0
    );
});
test('manual classification, note and deliberate unknown win; projection recomputes without sticky auto decisions', () => {
    for (const classification of ['exchange', 'external_deposit', 'unknown']) {
        const manual = {
            id: 'krw',
            classification,
            note: 'synthetic preserved note',
            revision: 7,
        };
        const out = project(state(pair(), [manual]), scope);
        assert.deepEqual(out.storedClassifications, [manual]);
        assert.equal(out.automaticClassifications.length, 0);
    }
    const source = state([row('reward', '이벤트입금', 'KRW', 100)]);
    const first = project(source, scope);
    assert.equal(project(first, scope).automaticClassifications.length, 1);
    const changed = project(
        {
            ...first,
            entries: [{ ...source.entries[0], rawType: '이벤트입금취소' }],
        },
        scope
    );
    assert.equal(changed.automaticClassifications.length, 0);
    assert.deepEqual(changed.classifications, []);
    const suppressed = project(
        {
            ...source,
            classifications: [
                {
                    id: 'reward',
                    classification: 'unknown',
                    revision: 1,
                    note: 'keep review',
                },
            ],
        },
        scope
    );
    assert.equal(suppressed.automaticClassifications.length, 0);
});
test('proof projection whitelists source-bound fields', () => {
    const e = pair()[0];
    e.cashTime.secret = 'must not expose';
    e.exchangeFee.secret = 'must not expose';
    assert.equal(verifiedCashTime(e).secret, undefined);
    assert.equal(verifiedExchangeFee(e).secret, undefined);
});
