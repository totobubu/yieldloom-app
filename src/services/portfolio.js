import { collection, getDocs, query } from 'firebase/firestore';
import { db, firebaseUser } from './firebaseClient';
import { summarizePortfolio } from './portfolioSummary';
import { apiUrl } from './apiUrl.js';

const pendingDashboards = new Map();

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

export async function loadPortfolioAsset(uid, ticker) {
    const dashboard = await loadPortfolioDashboard(uid);
    return (
        dashboard.assets.find(
            (item) => item.ticker === String(ticker).toUpperCase()
        ) ?? null
    );
}

async function fetchPortfolioDashboard(uid, user, fetcher) {
    if (!uid || user?.uid !== uid) return summarizePortfolio([]);
    const response = await fetcher(
        apiUrl('/api/portfolio-capital?view=dashboard'),
        {
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
            cache: 'no-store',
        }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw Object.assign(
            new Error(payload.error || '포트폴리오를 불러오지 못했습니다.'),
            { code: payload.code, status: response.status }
        );
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const dashboard = summarizePortfolio(payload.assets || []);
    if (warnings.some((item) => item.stage === 'legacy'))
        dashboard.summary.historicalCount = null;
    return { ...dashboard, warnings };
}

export function loadPortfolioDashboard(
    uid,
    { user = firebaseUser.value, fetcher = fetch } = {}
) {
    if (!uid || user?.uid !== uid)
        return Promise.resolve(summarizePortfolio([]));
    const existing = pendingDashboards.get(uid);
    if (existing) return existing;
    const request = fetchPortfolioDashboard(uid, user, fetcher).finally(() => {
        if (pendingDashboards.get(uid) === request)
            pendingDashboards.delete(uid);
    });
    pendingDashboards.set(uid, request);
    return request;
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
