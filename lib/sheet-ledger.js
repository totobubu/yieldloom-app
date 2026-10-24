// Private trial ledger contract. No Google tokens or raw workbook data are persisted.
export const accounts = [
    { id: 'husband', name: '남편' },
    { id: 'wife', name: '아내' },
];
export const numericFields = [
    'quantity',
    'unitPriceUsd',
    'unitPriceKrw',
    'purchaseUsd',
    'purchaseKrw',
    'exchangeRate',
    'netDividendUsd',
    'netDividendKrw',
    'grossDividendUsd',
    'grossDividendKrw',
    'dividendPerShare',
    'commissionUsd',
    'commissionKrw',
    'taxUsd',
    'taxKrw',
    'fxFeeUsd',
    'fxFeeKrw',
];
export const fundingSources = ['본인원금', '배당금', '혼합', '기타', '미확인'];
export const statuses = ['확정', '추정', '미확인'];
export const types = ['BUY', 'DIVIDEND', 'SELL', 'FEE'];
export const sourceTabs = ['夫', '夫배당', '妻', '妻배당'];
const aliases = {
    와맥: 'YMAX',
    제피: 'JEPI',
    렛츠퍽: 'LFGY',
    위페이: 'WPAY',
    테슬리: 'TSLY',
    미스티: 'MSTY',
    티큐: 'TQQQ',
};
export function spreadsheetId(url) {
    try {
        const u = new URL(url);
        const match = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
        if (
            u.protocol === 'https:' &&
            u.hostname === 'docs.google.com' &&
            match
        )
            return match[1];
    } catch {
        /* handled below */
    }
    throw new Error('올바른 Google Sheets URL을 입력해 주세요.');
}
function raw(cell) {
    const v = cell?.effectiveValue || cell?.userEnteredValue || {};
    return v.numberValue ?? v.stringValue ?? cell?.formattedValue ?? null;
}
function literal(cell) {
    const v = cell?.userEnteredValue;
    if (v?.numberValue != null) return v.numberValue;
    if (v?.stringValue != null) return number(v.stringValue);
    // Literal additive expressions record multiple fills in the original sheet.
    const f = v?.formulaValue;
    if (f && /^=[+-]?\d+(?:\.\d+)?(?:\s*[+-]\s*\d+(?:\.\d+)?)*$/.test(f))
        return (
            f
                .slice(1)
                .replace(/\s/g, '')
                .match(/[+-]?\d+(?:\.\d+)?/g) || []
        ).reduce((s, n) => s + Number(n), 0);
    return null;
}
function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null || String(value).includes('#')) return null;
    const text = String(value).replace(/[$₩,주\s]/g, '');
    return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}
function num(cell) {
    return literal(cell) ?? number(raw(cell));
}
export function sheetDate(value) {
    if (typeof value === 'number' && value > 30000 && value < 80000)
        return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
            .toISOString()
            .slice(0, 10);
    const m = String(value ?? '')
        .trim()
        .match(/^(\d{2}|\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
    if (!m) return null;
    const y = Number(m[1]) + (m[1].length === 2 ? 2000 : 0);
    const date = `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const d = new Date(date);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date
        ? date
        : null;
}
const rounded = (n) => Math.round(n * 1e8) / 1e8;
export function normalizeWorkbook(workbook, cutoff) {
    const rows = [],
        excluded = [],
        warnings = [];
    for (const tab of sourceTabs) {
        const sheet = workbook.sheets?.find((s) => s.properties.title === tab);
        if (!sheet) throw new Error(`원본 시트 '${tab}'가 없습니다.`);
        let inheritedDates = null;
        for (const block of sheet.data || []) {
            for (const [i, row] of (block.rowData || []).entries()) {
                const rowNumber = (block.startRow || 0) + i + 1;
                if (
                    rowNumber <=
                    (tab.includes('배당') ? 5 : tab === '夫' ? 3 : 4)
                )
                    continue;
                const cells = row.values || [];
                const accountId = tab.startsWith('夫') ? 'husband' : 'wife';
                const source = {
                    spreadsheetId: workbook.spreadsheetId,
                    sheet: tab,
                    sheetId: sheet.properties.sheetId,
                    row: rowNumber,
                };
                const reject = (reason, symbol = '') =>
                    excluded.push({ ...source, symbol, reason });
                const make = (type, symbol) => ({
                    ...Object.fromEntries(numericFields.map((f) => [f, null])),
                    id: `${workbook.spreadsheetId}:${source.sheetId}:${rowNumber}:${type}:${symbol}`,
                    accountId,
                    type,
                    symbol,
                    date: null,
                    exDate: null,
                    paymentDate: null,
                    source,
                    fundingSource: '미확인',
                    reinvested: null,
                    status: '미확인',
                    needsReview: true,
                    fieldStatus: {},
                    evidence: [],
                });
                if (tab.includes('배당')) {
                    const text = String(raw(cells[0]) || '').trim();
                    const symbol = aliases[text] || text;
                    const dateValue = raw(cells[1]);
                    if (/^20\d{2}$/.test(text)) inheritedDates = null;
                    const dates =
                        typeof dateValue === 'number'
                            ? [sheetDate(dateValue)]
                            : String(dateValue || '')
                                  .split('\n')
                                  .map(sheetDate)
                                  .filter(Boolean);
                    if (dates.length) inheritedDates = dates;
                    if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) continue;
                    if (num(cells[5]) == null) {
                        if (
                            cells[5]?.userEnteredValue?.formulaValue ||
                            cells[5]?.effectiveValue?.errorValue
                        )
                            reject(
                                '계산식 배당 또는 오류: 실제 지급액 확인 필요',
                                symbol
                            );
                        continue;
                    }
                    const usedDates = dates.length ? dates : inheritedDates;
                    if (!usedDates?.length) {
                        reject('배당 지급일 확인 필요', symbol);
                        continue;
                    }
                    const paymentDate = usedDates.at(-1);
                    if (paymentDate > cutoff) {
                        reject('미래 예상 배당', symbol);
                        continue;
                    }
                    if (literal(cells[5]) == null) {
                        reject('실제 지급 근거가 없는 계산식 배당', symbol);
                        continue;
                    }
                    const r = make('DIVIDEND', symbol);
                    Object.assign(r, {
                        date: paymentDate,
                        paymentDate,
                        exDate: usedDates.length > 1 ? usedDates[0] : null,
                        netDividendUsd: num(cells[5]),
                        grossDividendUsd: num(cells[6]),
                        grossDividendKrw: num(cells[7]),
                        netDividendKrw: num(cells[8]),
                        exchangeRate: num(cells[9]),
                        dividendPerShare: num(cells[10]),
                    });
                    for (const currency of ['Usd', 'Krw']) {
                        const gross = r[`grossDividend${currency}`],
                            net = r[`netDividend${currency}`];
                        if (gross != null && net != null && gross >= net) {
                            r[`tax${currency}`] = rounded(gross - net);
                            r.fieldStatus[`tax${currency}`] = '추정';
                        } else if (gross != null && net != null)
                            r.evidence.push('세전보다 세후 배당이 큽니다.');
                    }
                    if (!dates.length) {
                        r.fieldStatus.paymentDate = '추정';
                        r.evidence.push(
                            '같은 날짜 묶음의 직전 지급일을 적용했습니다.'
                        );
                    }
                    r.status = '추정';
                    rows.push(r);
                } else {
                    const date = sheetDate(raw(cells[0]));
                    if (!date) continue;
                    // The wife sheet stores quantity + total amount, not unit price.
                    const groups =
                        tab === '夫'
                            ? [
                                  ['YMAX', 1, 3],
                                  ['JEPI', 8, 10],
                                  ['LFGY', 15, 16],
                              ]
                            : [
                                  ['TQQQ', 1, 2],
                                  ['TOPW', 5, 6],
                                  ['LFGY', 9, 10],
                                  ['TSLY', 13, 14],
                                  ['MSTY', 17, 18],
                                  ['AMZY', 25, 26],
                                  ['YMAG', 29, 30],
                                  ['QDTE', 33, 34],
                              ];
                    for (const [symbol, qi, ai] of groups) {
                        const quantity = num(cells[qi]),
                            amount = num(cells[ai]);
                        if (!quantity) continue;
                        if (amount == null) {
                            reject(
                                '거래금액 누락 또는 수식 오류: 확인 필요',
                                symbol
                            );
                            continue;
                        }
                        if (date > cutoff) {
                            reject('미래 예상 매매', symbol);
                            continue;
                        }
                        if (literal(cells[qi]) == null) {
                            reject('실제 수량 근거가 없는 계산식 매매', symbol);
                            continue;
                        }
                        const r = make(quantity < 0 ? 'SELL' : 'BUY', symbol);
                        Object.assign(r, {
                            date,
                            quantity: Math.abs(quantity),
                            purchaseUsd: Math.abs(amount),
                            unitPriceUsd: rounded(Math.abs(amount / quantity)),
                        });
                        r.fieldStatus.unitPriceUsd = '추정';
                        r.evidence.push(
                            '매수단가는 거래금액 ÷ 수량으로 계산했습니다. 환율·원화 금액은 거래별 근거가 없어 미확인입니다.'
                        );
                        rows.push(r);
                    }
                }
            }
        }
    }
    inferReinvestment(rows);
    warnings.push(
        '거래수수료와 환전비용은 원본에 없어 미확인입니다. 합계는 확인된 금액만 포함합니다.',
        '시트의 과거 계산 행은 실제 거래 근거 확인 전까지 제외됩니다.'
    );
    return {
        rows: rows.sort(
            (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
        ),
        excluded,
        warnings,
        cutoff,
    };
}
export function inferReinvestment(rows) {
    for (const account of accounts) {
        const pool = [];
        for (const r of rows
            .filter((r) => r.accountId === account.id)
            .sort(
                (a, b) =>
                    a.date.localeCompare(b.date) ||
                    Number(b.type === 'DIVIDEND') -
                        Number(a.type === 'DIVIDEND') ||
                    a.id.localeCompare(b.id)
            )) {
            if (r.type === 'DIVIDEND' && r.netDividendUsd > 0)
                pool.push({ row: r, remaining: r.netDividendUsd });
            if (r.type !== 'BUY' || !(r.purchaseUsd > 0)) continue;
            const eligible = pool
                .filter(
                    (p) =>
                        (Date.parse(r.date) - Date.parse(p.row.date)) /
                            86400000 <=
                            7 && p.remaining > 0
                )
                .sort(
                    (a, b) =>
                        Number(b.row.symbol === r.symbol) -
                            Number(a.row.symbol === r.symbol) ||
                        a.row.date.localeCompare(b.row.date)
                );
            let funded = 0;
            for (const p of eligible) {
                const used = Math.min(p.remaining, r.purchaseUsd - funded);
                if (used <= 0) break;
                p.remaining = rounded(p.remaining - used);
                funded = rounded(funded + used);
                r.evidence.push(
                    `${p.row.source.sheet} ${p.row.source.row}행 배당 $${used.toFixed(2)} 연결 추정`
                );
            }
            r.dividendFundingUsd = funded;
            r.fundingSource =
                funded >= r.purchaseUsd * 0.9
                    ? '배당금'
                    : funded > 0
                      ? '혼합'
                      : '미확인';
            r.reinvested = funded > 0 ? funded >= r.purchaseUsd * 0.9 : null;
            if (funded > 0) {
                r.status = '추정';
                r.fieldStatus.fundingSource = '추정';
                r.fieldStatus.reinvested = '추정';
            }
        }
    }
}
export function validateEdit(existing, patch) {
    const next = { ...existing, fieldStatus: { ...existing.fieldStatus } };
    for (const key of numericFields)
        if (Object.hasOwn(patch, key)) {
            const v = patch[key];
            if (
                v !== null &&
                (typeof v !== 'number' ||
                    !Number.isFinite(v) ||
                    v < 0 ||
                    v > 1e15)
            )
                throw new Error(
                    `${key}: 0 이상의 숫자 또는 미확인을 입력해 주세요.`
                );
            next[key] = v;
            if (v !== existing[key])
                next.fieldStatus[key] = v == null ? '미확인' : '확정';
        }
    for (const key of ['date', 'exDate', 'paymentDate'])
        if (Object.hasOwn(patch, key)) {
            const v = patch[key];
            if (
                (key === 'date' || v != null) &&
                (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || sheetDate(v) !== v)
            )
                throw new Error('날짜를 확인해 주세요.');
            next[key] = v;
        }
    if (Object.hasOwn(patch, 'symbol')) {
        if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(patch.symbol))
            throw new Error('티커를 확인해 주세요.');
        next.symbol = patch.symbol;
    }
    if (
        !fundingSources.includes(patch.fundingSource) ||
        !statuses.includes(patch.status) ||
        ![true, false, null].includes(patch.reinvested)
    )
        throw new Error('원금출처·재투자·상태를 확인해 주세요.');
    Object.assign(next, {
        fundingSource: patch.fundingSource,
        status: patch.status,
        reinvested: patch.reinvested,
        needsReview: patch.status !== '확정' || hasUnknownCosts(next),
    });
    if (patch.fundingSource !== existing.fundingSource)
        next.fieldStatus.fundingSource =
            patch.fundingSource === '미확인' ? '미확인' : '확정';
    if (patch.reinvested !== existing.reinvested)
        next.fieldStatus.reinvested =
            patch.reinvested == null ? '미확인' : '확정';
    return next;
}
export function summarize(rows) {
    const sum = (field, predicate = () => true) =>
        rounded(
            rows.filter(predicate).reduce((n, r) => n + (r[field] || 0), 0)
        );
    return {
        principalUsd: sum(
            'purchaseUsd',
            (r) => r.type === 'BUY' && r.fundingSource === '본인원금'
        ),
        purchaseUsd: sum('purchaseUsd', (r) => r.type === 'BUY'),
        grossUsd: sum('grossDividendUsd'),
        netUsd: sum('netDividendUsd'),
        costsUsd: sum('commissionUsd') + sum('taxUsd') + sum('fxFeeUsd'),
        costsKrw: sum('commissionKrw') + sum('taxKrw') + sum('fxFeeKrw'),
        reinvestedUsd: rounded(
            rows.reduce(
                (total, r) =>
                    total +
                    (r.type !== 'BUY' ||
                    (r.reinvested === false &&
                        r.fieldStatus.reinvested === '확정')
                        ? 0
                        : r.fieldStatus.reinvested !== '추정' &&
                            r.reinvested === true
                          ? r.purchaseUsd || 0
                          : ['배당금', '혼합'].includes(r.fundingSource)
                            ? Math.min(
                                  r.dividendFundingUsd || 0,
                                  r.purchaseUsd || 0
                              )
                            : 0),
                0
            )
        ),
        unknown: rows.filter((r) => r.needsReview || hasUnknownCosts(r)).length,
    };
}
function hasUnknownCosts(row) {
    return ['commission', 'fxFee'].some(
        (kind) => row[`${kind}Usd`] == null && row[`${kind}Krw`] == null
    );
}
