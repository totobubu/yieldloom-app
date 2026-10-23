const numeric = (value) =>
    value != null && value !== '' && Number.isFinite(Number(value))
        ? Number(value)
        : null;
const date = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value : null;
const equalAmount = (a, b) =>
    numeric(a) == null ||
    numeric(b) == null ||
    Math.abs(Number(a) - Number(b)) <=
        Number.EPSILON *
            Math.max(1, Math.abs(Number(a)), Math.abs(Number(b))) *
            8;
const priority = { final: 3, estimated: 2, unclassified: 1 };

// Join only an unambiguous date, currency and amount match. No date proximity or inferred ROC amounts.
export function dividendRocHistory(
    history = [],
    observations = [],
    currency = 'USD'
) {
    const rows = history
        .filter((row) => !row.forecasted && date(row.date))
        .map((row, index) => ({
            id: `dividend-${row.date}-${index}`,
            exDate: row.date,
            payableDate: date(row.payableDate || row.payable_date),
            currency: row.currency || currency,
            distributionAmount: row.amountFixed ?? row.amount ?? null,
            rocAmount: null,
            rocPercent: null,
            evidence: [],
            note: '',
        }));
    const groups = new Map();
    for (const row of observations) {
        if (row.scope !== 'payment') continue;
        // Records without dates remain distinct instead of combining unrelated observations.
        const key = JSON.stringify([
            row.currency || currency,
            row.exDate || null,
            row.payableDate || null,
            numeric(row.distributionAmount),
            !row.exDate && !row.payableDate
                ? row.observationId || groups.size
                : null,
        ]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    for (const [key, evidence] of groups) {
        const best = Math.max(
            ...evidence.map((row) => priority[row.classificationStatus] || 0)
        );
        const preferred = evidence.filter(
            (row) => (priority[row.classificationStatus] || 0) === best
        );
        const observation = preferred[0];
        const conflict = ['rocAmount', 'rocPercent'].some(
            (field) =>
                new Set(
                    preferred
                        .map((row) => numeric(row[field]))
                        .filter((v) => v != null)
                ).size > 1
        );
        const exDate = date(observation.exDate),
            payableDate = date(observation.payableDate);
        const rowCurrency = observation.currency || currency;
        const candidates = rows.filter(
            (row) =>
                !row.evidence.length &&
                row.currency === rowCurrency &&
                (exDate
                    ? row.exDate === exDate
                    : payableDate && row.payableDate === payableDate) &&
                (!payableDate ||
                    !row.payableDate ||
                    payableDate === row.payableDate) &&
                equalAmount(
                    row.distributionAmount,
                    observation.distributionAmount
                )
        );
        const target =
            candidates.length === 1
                ? candidates[0]
                : {
                      id: `roc-${key}`,
                      exDate,
                      payableDate,
                      currency: rowCurrency,
                      distributionAmount:
                          observation.distributionAmount ?? null,
                      note: rows.some(
                          (row) =>
                              row.exDate &&
                              row.exDate === exDate &&
                              row.currency === rowCurrency
                      )
                          ? '날짜는 같지만 금액 또는 지급 건이 달라 별도 표시'
                          : '',
                  };
        if (candidates.length !== 1) rows.push(target);
        target.payableDate ||= payableDate;
        // Prefer the ROC document's original decimal string, without rounding it for the table.
        target.distributionAmount =
            observation.distributionAmount ?? target.distributionAmount;
        target.rocAmount = conflict
            ? null
            : (preferred.find((row) => numeric(row.rocAmount) != null)
                  ?.rocAmount ?? null);
        target.rocPercent = conflict
            ? null
            : (preferred.find((row) => numeric(row.rocPercent) != null)
                  ?.rocPercent ?? null);
        target.evidence = evidence;
        if (conflict) target.note = 'ROC 자료 간 값이 달라 원문 확인 필요';
    }
    return rows.sort(
        (a, b) =>
            String(b.exDate || b.payableDate || '').localeCompare(
                String(a.exDate || a.payableDate || '')
            ) || a.id.localeCompare(b.id)
    );
}

// Aggregate only dated payment rows. Missing ROC evidence stays missing instead
// of being treated as 0%, and percentages are weighted by the distributions
// for which a usable ROC percentage was published.
export function monthlyDividendRocSummary(rows = []) {
    const months = new Map();
    for (const row of rows) {
        const paymentDate = date(row.exDate);
        const distribution = numeric(row.distributionAmount);
        if (!paymentDate || distribution == null) continue;
        const key = paymentDate.slice(0, 7);
        const bucket = months.get(key) ?? {
            key,
            year: key.slice(0, 4),
            month: Number(key.slice(5, 7)),
            currency: row.currency || null,
            distributionTotal: 0,
            paymentCount: 0,
            rocKnownCount: 0,
            weightedRocPercent: null,
            rows: [],
            _rocDistributionTotal: 0,
            _rocWeightedTotal: 0,
        };
        bucket.distributionTotal += distribution;
        bucket.paymentCount++;
        bucket.rows.push(row);
        const rocPercent = numeric(row.rocPercent);
        if (rocPercent != null && distribution > 0) {
            bucket.rocKnownCount++;
            bucket._rocDistributionTotal += distribution;
            bucket._rocWeightedTotal += distribution * rocPercent;
        }
        months.set(key, bucket);
    }
    return [...months.values()]
        .map((bucket) => {
            const { _rocDistributionTotal, _rocWeightedTotal, ...summary } =
                bucket;
            summary.weightedRocPercent = _rocDistributionTotal
                ? _rocWeightedTotal / _rocDistributionTotal
                : null;
            return summary;
        })
        .sort((a, b) => a.key.localeCompare(b.key));
}
