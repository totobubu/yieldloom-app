import {
    applyCors,
    dispatchRefresh,
    validateRefreshInput,
} from '../_utils/content-refresh.js';

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try {
        const input = await validateRefreshInput(req.body);
        const result = await dispatchRefresh(input);
        if (result.conflict?.type === 'active') {
            return res.status(409).json({ error: 'A content refresh is already running' });
        }
        if (result.conflict?.type === 'cooldown') {
            return res.status(429).json({ error: 'This target was refreshed less than 10 minutes ago' });
        }
        return res.status(202).json({
            requestId: result.requestId,
            workflowRunId: result.workflowRunId,
            statusUrl: `/api/content-refresh/status?requestId=${encodeURIComponent(result.requestId)}`,
        });
    } catch (error) {
        const status = error instanceof TypeError ? 400 : error.status === 403 ? 503 : 500;
        return res.status(status).json({
            error: status === 400 ? error.message : 'Unable to start content refresh',
        });
    }
}
