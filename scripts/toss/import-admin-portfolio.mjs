#!/usr/bin/env node
/**
 * Imports Toss statement history and a live read-only Toss holdings snapshot
 * into the Firebase administrator's private portfolios document tree.
 *
 * Required environment variables:
 *   FIRESTORE_SA_KEY     Firebase service-account JSON (one line)
 *   TOSS_CLIENT_ID, TOSS_CLIENT_SECRET
 *   TOSS_PDF_PASSWORD   Password shared by the local statement PDFs
 *
 * Usage:
 *   node scripts/toss/import-admin-portfolio.mjs             # preview only
 *   node scripts/toss/import-admin-portfolio.mjs --apply     # write Firestore
 *   node scripts/toss/import-admin-portfolio.mjs --uid FIREBASE_UID --apply
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import admin from 'firebase-admin';

const PROJECT_ROOT = process.cwd();
const STATEMENT_DIRECTORY = join(PROJECT_ROOT, 'TossStatements');
const APPLY = process.argv.includes('--apply');
const SKIP_PDF = process.argv.includes('--skip-pdf');
const emailIndex = process.argv.indexOf('--email');
const uidIndex = process.argv.indexOf('--uid');
const ADMIN_EMAIL = emailIndex >= 0 ? process.argv[emailIndex + 1] : 'jomalkeun@gmail.com';
const ADMIN_UID = uidIndex >= 0 ? process.argv[uidIndex + 1] : null;

function loadLocalEnvironment(filename) {
    const path = join(PROJECT_ROOT, filename);
    if (!existsSync(path)) return;
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
        const separator = line.indexOf('=');
        const name = line.slice(0, separator);
        if (process.env[name]) continue;
        let value = line.slice(separator + 1).trim();
        if (name === 'FIRESTORE_SA_KEY' && value.startsWith('{')) {
            let braces = (value.match(/{/g) || []).length - (value.match(/}/g) || []).length;
            while (braces > 0 && index + 1 < lines.length) {
                index += 1;
                value += `\n${lines[index]}`;
                braces += (lines[index].match(/{/g) || []).length - (lines[index].match(/}/g) || []).length;
            }
        }
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[name] = value;
    }
}

loadLocalEnvironment('.env.local');
loadLocalEnvironment('.env.development');

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} 환경 변수가 필요합니다.`);
    return value;
}

function stableId(parts) {
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

function normalizeType(rawType) {
    if (/매수|구매|buy/i.test(rawType || '')) return 'buy';
    if (/매도|판매|sell/i.test(rawType || '')) return 'sell';
    if (/배당.*취소|dividend_reversal/i.test(rawType || '')) return 'dividend_reversal';
    if (/배당|dividend/i.test(rawType || '')) return 'dividend';
    return 'unknown';
}

function parseStatements() {
    required('TOSS_PDF_PASSWORD');
    const pdfs = readdirSync(STATEMENT_DIRECTORY)
        .filter((name) => name.toLowerCase().endsWith('.pdf'))
        .sort();
    if (!pdfs.length) throw new Error('TossStatements 폴더에 PDF가 없습니다.');

    const transactions = [];
    for (const filename of pdfs) {
        const result = spawnSync('python', ['api/toss_extractor.py', join('TossStatements', filename)], {
            cwd: PROJECT_ROOT,
            env: process.env,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        });
        if (result.status !== 0) throw new Error(`${filename} 거래내역을 읽지 못했습니다.`);
        const data = JSON.parse(result.stdout);
        transactions.push(...(Array.isArray(data.transactions) ? data.transactions : []));
    }
    return transactions.filter((item) => item.ticker && item.date);
}

async function tossFetch(path, headers = {}) {
    const tokenResponse = await fetch('https://openapi.tossinvest.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: required('TOSS_CLIENT_ID'),
            client_secret: required('TOSS_CLIENT_SECRET'),
        }),
    });
    if (!tokenResponse.ok) throw new Error(`토스 토큰 발급 실패: ${tokenResponse.status}`);
    const { access_token: token } = await tokenResponse.json();
    const response = await fetch(`https://openapi.tossinvest.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, ...headers },
    });
    if (!response.ok) throw new Error(`토스 조회 실패: ${response.status}`);
    return response.json();
}

async function fetchLiveHoldings() {
    const accountsPayload = await tossFetch('/api/v1/accounts');
    const accounts = Array.isArray(accountsPayload?.result) ? accountsPayload.result : [];
    const holdings = [];
    for (const account of accounts) {
        if (!Number.isSafeInteger(account?.accountSeq)) continue;
        const payload = await tossFetch('/api/v1/holdings', {
            'X-Tossinvest-Account': String(account.accountSeq),
        });
        for (const item of payload?.result?.items || []) {
            const shares = Number(item?.quantity);
            if (item?.symbol && Number.isFinite(shares) && shares > 0) {
                holdings.push({ ticker: item.symbol.toUpperCase(), shares, name: item.name || null, market: item.marketCountry || null });
            }
        }
    }
    return holdings;
}

async function main() {
    const serviceAccount = JSON.parse(required('FIRESTORE_SA_KEY'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    const db = admin.firestore();
    const user = ADMIN_UID
        ? await admin.auth().getUser(ADMIN_UID)
        : await admin.auth().getUserByEmail(ADMIN_EMAIL);
    if (user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        throw new Error('관리자 UID와 이메일이 일치하지 않습니다.');
    }
    const pdfTransactions = SKIP_PDF ? [] : parseStatements();
    const liveHoldings = await fetchLiveHoldings();

    const historicalCodes = [...new Set(pdfTransactions.map((item) => item.ticker))];
    const historicalMappings = new Map();
    for (const code of historicalCodes) {
        const snapshot = await db.collection('stockMappings').doc(code).get();
        historicalMappings.set(code, snapshot.exists ? snapshot.data() : {});
    }
    const liveMappings = new Map();
    for (const holding of liveHoldings) {
        const snapshot = await db.collection('stockMappings').where('symbol', '==', holding.ticker).limit(1).get();
        liveMappings.set(holding.ticker, snapshot.empty ? {} : snapshot.docs[0].data());
    }

    const priority = new Map();
    for (const code of historicalCodes) priority.set(code, 'historical');
    for (const holding of liveHoldings) priority.set(holding.ticker, 'current');

    if (!APPLY) {
        console.log(JSON.stringify({
            mode: 'preview',
            adminUid: user.uid,
            pdfTransactionCount: pdfTransactions.length,
            historicalAssetCount: historicalCodes.length,
            liveHoldingCount: liveHoldings.length,
            priorityAssetCount: priority.size,
        }));
        return;
    }

    const writes = [];
    const now = admin.firestore.FieldValue.serverTimestamp();
    const adminPortfolio = db.collection('portfolios').doc(user.uid);
    const assets = adminPortfolio.collection('assets');
    writes.push({ ref: adminPortfolio, data: {
        ownerUid: user.uid,
        ownerEmail: user.email,
        portfolioImportedAt: now,
        portfolioSources: ['toss-pdf', 'toss-api'],
        updatedAt: now,
    }, options: { merge: true } });
    for (const transaction of pdfTransactions) {
        const mapping = historicalMappings.get(transaction.ticker) || {};
        const assetId = mapping.isin || transaction.ticker;
        const transactionId = stableId(['toss-pdf', transaction.ticker, transaction.date, transaction.type, transaction.quantity, transaction.transaction_amount_krw]);
        writes.push({ ref: assets.doc(assetId), data: {
            type: '주식', isin: mapping.isin || transaction.ticker, symbol: mapping.symbol || null,
            name: mapping.koName || transaction.stock_name || null, portfolioPriority: 'historical',
            prioritySource: 'toss-pdf', updatedAt: now,
        }, options: { merge: true } });
        writes.push({ ref: assets.doc(assetId).collection('transactions').doc(transactionId), data: {
            source: 'toss-pdf', rawType: transaction.type, type: normalizeType(transaction.type),
            date: transaction.date.replaceAll('.', ''), currency: transaction.unit_price_usd ? 'USD' : 'KRW',
            quantity: transaction.quantity, amount: transaction.transaction_amount_krw,
            price: transaction.unit_price_krw, commission: transaction.commission_krw, tax: transaction.tax_krw,
            nativeAmount: transaction.transaction_amount_usd ?? null, nativePrice: transaction.unit_price_usd ?? null,
            importedAt: now,
        }, options: { merge: true } });
    }
    for (const holding of liveHoldings) {
        const mapping = liveMappings.get(holding.ticker) || {};
        const assetId = mapping.isin || `STOCK_${holding.ticker}`;
        writes.push({ ref: assets.doc(assetId), data: {
            type: '주식', isin: mapping.isin || null, symbol: holding.ticker, name: mapping.koName || holding.name,
            portfolioPriority: 'current', prioritySource: 'toss-api', holdingShares: holding.shares,
            holdings: { toss: { amount: holding.shares, source: 'toss-api' } }, updatedAt: now,
        }, options: { merge: true } });
    }
    for (let index = 0; index < writes.length; index += 450) {
        const batch = db.batch();
        for (const write of writes.slice(index, index + 450)) batch.set(write.ref, write.data, write.options);
        await batch.commit();
    }
    const verified = await assets.where('portfolioPriority', '==', 'current').get();
    console.log(JSON.stringify({ mode: 'applied', adminUid: user.uid, pdfTransactionCount: pdfTransactions.length, liveHoldingCount: liveHoldings.length, writeCount: writes.length, verifiedCurrentAssetCount: verified.size }));
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
