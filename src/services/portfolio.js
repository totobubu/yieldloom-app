import { collection, getDocs, query } from 'firebase/firestore';
import { db } from './firebaseClient';
import { summarizePortfolio } from './portfolioSummary';
import { apiUrl } from './apiUrl.js';

export async function loadPortfolioAssets(uid) {
    if (!db || !uid) return [];
    let snapshot;
    try {
        snapshot = await getDocs(
            query(collection(db, 'portfolios', uid, 'assets'))
        );
    } catch (error) {
        error.portfolioStage = 'assets';
        throw error;
    }
    return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

export function portfolioTickerStates(assets) {
    const states = new Map();
    for (const asset of assets) {
        const ticker = String(asset.symbol || '')
            .trim()
            .toUpperCase();
        if (!ticker) continue;
        if (!states.has(ticker) || asset.portfolioPriority === 'current')
            states.set(
                ticker,
                asset.portfolioPriority === 'current' ? 'current' : 'historical'
            );
    }
    return states;
}

// Some older imports kept the ledger inline; do not erase it with an empty subcollection.
async function loadAssetTransactions(uid, asset, store = 'portfolios') {
    const snapshot = await getDocs(
        collection(db, store, uid, 'assets', asset.id, 'transactions')
    );
    return snapshot.empty
        ? Array.isArray(asset.transactions)
            ? asset.transactions
            : []
        : snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

export async function loadPortfolioAsset(uid, ticker) {
    const dashboard = await loadPortfolioDashboard(uid);
    return (
        dashboard.assets.find(
            (item) => item.ticker === String(ticker).toUpperCase()
        ) ?? null
    );
}

export async function loadPortfolioDashboard(uid) {
    const assets = await loadPortfolioAssets(uid);
    if (!db || !uid) return summarizePortfolio([]);
    const warnings = [];
    const withTransactions = await Promise.all(
        assets.map(async (asset) => {
            try {
                return {
                    ...asset,
                    transactions: await loadAssetTransactions(uid, asset),
                };
            } catch (error) {
                warnings.push({
                    stage: 'transactions',
                    code: error.code || 'unknown',
                });
                return { ...asset, transactions: [], ledgerUnavailable: true };
            }
        })
    );
    // Legacy migrations sometimes copied only holdings. Read the owner's old ledger
    // when the active store has no rows, without writing or fabricating transactions.
    if (
        !warnings.length &&
        !withTransactions.some((asset) => asset.transactions.length)
    ) {
        try {
            const legacy = await getDocs(
                collection(db, 'adminPortfolios', uid, 'assets')
            );
            const legacyAssets = await Promise.all(
                legacy.docs.map(async (item) => {
                    const asset = { ...item.data(), id: item.id };
                    return {
                        ...asset,
                        transactions: await loadAssetTransactions(
                            uid,
                            asset,
                            'adminPortfolios'
                        ),
                    };
                })
            );
            for (const old of legacyAssets) {
                const current = withTransactions.find(
                    (asset) =>
                        asset.id === old.id ||
                        (asset.symbol &&
                            old.symbol &&
                            asset.symbol.toUpperCase() ===
                                old.symbol.toUpperCase())
                );
                if (current) current.transactions = old.transactions;
                else withTransactions.push(old);
            }
        } catch (error) {
            warnings.push({ stage: 'legacy', code: error.code || 'unknown' });
            for (const asset of withTransactions)
                asset.ledgerUnavailable = true;
        }
    }
    const dashboard = summarizePortfolio(withTransactions);
    if (warnings.some((item) => item.stage === 'legacy')) {
        // Unknown history must not be reported as a confirmed empty portfolio.
        dashboard.summary.historicalCount = null;
    }
    return { ...dashboard, warnings };
}

export async function previewTossStatement(user, file, password) {
    if (!user || !file || !password)
        throw new Error('PDF와 비밀번호를 입력하세요.');
    const form = new FormData();
    form.append('file', file);
    form.append('password', password);
    const response = await fetch(
        apiUrl('/api/portfolio-import?action=preview'),
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
            body: form,
        }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(payload.error || '거래내역을 확인하지 못했습니다.');
    return payload;
}

export async function commitTossStatement(user, sessionId, acceptedIds) {
    if (!user || !sessionId || !acceptedIds?.length)
        throw new Error('확정할 거래를 선택해 주세요.');
    const response = await fetch(
        apiUrl('/api/portfolio-import?action=commit'),
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${await user.getIdToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionId, acceptedIds }),
        }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(payload.error || '거래내역을 저장하지 못했습니다.');
    return payload;
}

// Compatibility entry point for integrations that intentionally skip the review UI.
export const importTossStatement = previewTossStatement;

export async function refreshTossStatementReview(user, sessionId) {
    const response = await fetch(
        apiUrl('/api/portfolio-import?action=refresh'),
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${await user.getIdToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionId }),
        }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(
            payload.error || '종목 연결 상태를 확인하지 못했습니다.'
        );
    return payload;
}
