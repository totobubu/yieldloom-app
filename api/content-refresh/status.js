import { applyCors, listRuns, publicRunState } from '../_utils/content-refresh.js';

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const requestId = String(req.query.requestId || '').trim();
    const workflowRunId = Number(req.query.workflowRunId || 0);
    if (!requestId && !workflowRunId) {
        return res.status(400).json({ error: 'requestId or workflowRunId is required' });
    }
    try {
        const runs = await listRuns();
        const run = runs.find((item) =>
            workflowRunId ? item.id === workflowRunId : String(item.display_title || '').endsWith(`:${requestId}`)
        );
        if (!run) return res.status(202).json({ status: 'queued', workflowRunId: null });
        return res.status(200).json(publicRunState(run));
    } catch {
        return res.status(500).json({ error: 'Unable to read content refresh status' });
    }
}
