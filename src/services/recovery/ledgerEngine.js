const incomeKinds = new Set(['dividend', 'interest']);
const externalKinds = new Set(['deposit']);

function krwValue(entry) {
    if (Number.isFinite(entry.krwAmount)) return Number(entry.krwAmount);
    if (Number.isFinite(entry.usdAmount) && Number.isFinite(entry.actualFxRate)) {
        return Number(entry.usdAmount) * Number(entry.actualFxRate);
    }
    return null;
}

/** Calculate cash recovery without treating transfers or sale principal twice. */
export function calculateRecoverySummary(entries) {
    const applied = entries
        .filter((entry) => entry.reviewStatus === 'applied')
        .slice()
        .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
    let externalContributionsKrw = 0;
    let externalWithdrawalsKrw = 0;
    let netIncomeKrw = 0;
    let missingFxCount = 0;

    applied.forEach((entry) => {
        const value = krwValue(entry);
        if (value == null) {
            if (entry.currency === 'USD') missingFxCount += 1;
            return;
        }
        const fees = Number(entry.feeKrw || 0) + Number(entry.taxKrw || 0);
        if (externalKinds.has(entry.kind)) externalContributionsKrw += Math.abs(value);
        if (entry.kind === 'withdrawal') externalWithdrawalsKrw += Math.abs(value);
        if (incomeKinds.has(entry.kind)) netIncomeKrw += Math.max(0, Math.abs(value) - fees);
    });

    return {
        externalContributionsKrw,
        externalWithdrawalsKrw,
        netIncomeKrw,
        incomeRecoveryRate:
            externalContributionsKrw > 0
                ? netIncomeKrw / externalContributionsKrw
                : null,
        missingFxCount,
    };
}

export function buildFundingPreview(entries) {
    const pools = { income: 0, proceeds: 0, principal: 0 };
    const rows = [];
    entries
        .filter((entry) => entry.reviewStatus === 'applied')
        .slice()
        .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)))
        .forEach((entry) => {
            const value = krwValue(entry);
            if (value == null) return;
            const amount = Math.abs(value);
            if (entry.kind === 'deposit') pools.principal += amount;
            if (incomeKinds.has(entry.kind)) pools.income += amount;
            if (entry.kind === 'sell') pools.proceeds += amount;
            if (entry.kind === 'buy') {
                let remaining = amount;
                const sources = {};
                // User-selected rule: dividend/interest cash is consumed first.
                ['income', 'proceeds', 'principal'].forEach((source) => {
                    const used = Math.min(pools[source], remaining);
                    if (used > 0) {
                        pools[source] -= used;
                        remaining -= used;
                        sources[source] = used;
                    }
                });
                rows.push({ ...entry, funding: sources, unreconciledKrw: remaining });
            }
        });
    return rows;
}
