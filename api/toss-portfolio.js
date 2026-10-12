import { createApiHandler } from '../lib/api-handler.js';
import { verifyFirebaseBearer, requireAllowedTossUser } from './_utils/firebase-auth.js';
import { fetchHoldings, listAccounts, TossPortfolioError } from './_utils/toss-portfolio.js';

async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const claims = await verifyFirebaseBearer(req);
    requireAllowedTossUser(claims);
    const action = String(req.query.action ?? 'accounts');
    if (action === 'accounts') return res.status(200).json(await listAccounts());
    if (action === 'holdings') return res.status(200).json(await fetchHoldings(Number(req.query.accountSeq)));
    return res.status(400).json({ error: 'Unsupported action' });
}

export default createApiHandler(async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        const status = error?.status ?? (error instanceof TossPortfolioError ? error.status : 500);
        res.status(status).json({ error: error instanceof Error ? error.message : 'Toss portfolio request failed' });
    }
});
