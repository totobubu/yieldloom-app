import {
    fetchHoldings,
    listAccounts,
    TossPortfolioError,
} from './_utils/toss-portfolio.js';

export default async function handler(req, res) {
    if (req.method !== 'GET')
        return res.status(405).json({ error: 'Method not allowed' });
    const action = String(req.query.action || 'accounts');
    try {
        if (action === 'accounts')
            return res.status(200).json(await listAccounts());
        if (action === 'holdings') {
            const accountSeq = Number(req.query.accountSeq);
            return res.status(200).json(await fetchHoldings(accountSeq));
        }
        return res.status(400).json({ error: 'Unsupported action' });
    } catch (error) {
        const status = error instanceof TossPortfolioError ? error.status : 500;
        return res.status(status).json({
            error:
                error instanceof Error
                    ? error.message
                    : 'Toss portfolio request failed',
        });
    }
}
