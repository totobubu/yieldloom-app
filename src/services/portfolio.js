import { collection, getDocs, query } from 'firebase/firestore';
import { db } from './firebaseClient';
import { summarizePortfolio } from './portfolioSummary';

export async function loadPortfolioAssets(uid) {
    if (!db || !uid) return [];
    const snapshot = await getDocs(query(collection(db, 'portfolios', uid, 'assets')));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function portfolioTickerStates(assets) {
    const states = new Map();
    for (const asset of assets) {
        const ticker = String(asset.symbol || '').trim().toUpperCase();
        if (!ticker) continue;
        states.set(ticker, asset.portfolioPriority === 'current' ? 'current' : 'historical');
    }
    return states;
}

export async function loadPortfolioAsset(uid, ticker) {
    const assets = await loadPortfolioAssets(uid);
    const asset = assets.find((item) => String(item.symbol || '').toUpperCase() === String(ticker).toUpperCase());
    if (!asset) return null;
    const transactions = await getDocs(collection(db, 'portfolios', uid, 'assets', asset.id, 'transactions'));
    return { ...asset, transactions: transactions.docs.map((item) => item.data()) };
}

export async function loadPortfolioDashboard(uid) {
    const assets = await loadPortfolioAssets(uid);
    const withTransactions = await Promise.all(assets.map(async (asset) => {
        const snapshot = await getDocs(collection(db, 'portfolios', uid, 'assets', asset.id, 'transactions'));
        return { ...asset, transactions: snapshot.docs.map((item) => item.data()) };
    }));
    return summarizePortfolio(withTransactions);
}

export async function importTossStatement(user, file, password) {
    if (!user || !file || !password) throw new Error('PDF와 비밀번호를 입력하세요.');
    const form = new FormData();
    form.append('file', file);
    form.append('password', password);
    const response = await fetch('/api/portfolio-import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '거래내역을 저장하지 못했습니다.');
    return payload;
}
