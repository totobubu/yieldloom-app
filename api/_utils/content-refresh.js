import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const WORKFLOW_FILE = 'content-studio-refresh.yml';
export const PROVIDERS = new Set([
    'amplify',
    'defiance',
    'globalx',
    'jpmorgan',
    'neos',
    'rex',
    'roundhill',
    'schwab',
    'yieldmax',
]);
export const ACTIVE_STATUSES = new Set([
    'queued',
    'in_progress',
    'waiting',
    'requested',
    'pending',
]);
export const COOLDOWN_MS = 10 * 60 * 1000;

const allowedOrigins = new Set([
    'https://totobubu.github.io',
    'http://localhost:5173',
    'http://localhost:3000',
].concat((process.env.CONTENT_REFRESH_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)));

export function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJson(relativePath) {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), relativePath), 'utf8'));
}

export function targetKey(input) {
    if (input.scope === 'provider') return `provider:${input.provider}`;
    if (input.scope === 'ticker') return `ticker:${input.ticker}`;
    if (input.scope === 'render') return `render:${input.eventId}`;
    return 'all:all';
}

export async function validateRefreshInput(body = {}) {
    const scope = String(body.scope || '').trim().toLowerCase();
    if (!['all', 'provider', 'ticker', 'render'].includes(scope)) {
        throw new TypeError('scope must be one of all, provider, ticker, or render');
    }
    if (scope === 'all') return { scope };
    if (scope === 'provider') {
        const provider = String(body.provider || '').trim().toLowerCase();
        if (!PROVIDERS.has(provider)) throw new TypeError('provider is not allowed');
        return { scope, provider };
    }
    if (scope === 'ticker') {
        const ticker = String(body.ticker || '').trim().toUpperCase();
        const index = await readJson('public/content-studio/distribution-index.json');
        if (!Array.isArray(index.tickers) || !index.tickers.some((row) => row.ticker === ticker)) {
            throw new TypeError('ticker is not present in the official distribution index');
        }
        return { scope, ticker };
    }
    const eventId = Number(body.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new TypeError('eventId must be a positive integer');
    const renders = await readJson('public/content-studio/renders.json');
    if (!Array.isArray(renders.renders) || !renders.renders.some(
        (row) => row.eventId === eventId && row.name === 'social-square.html'
    )) {
        throw new TypeError('eventId is not present in the render index');
    }
    return { scope, eventId };
}

export function githubConfig() {
    const token = process.env.GITHUB_ACTIONS_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY || 'totobubu/totobubu.github.io';
    const [owner, repo] = repository.split('/');
    if (!token || !owner || !repo) throw new Error('Content refresh service is not configured');
    return { token, owner, repo };
}

export async function githubRequest(endpoint, options = {}) {
    const { token, owner, repo } = githubConfig();
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${endpoint}`, {
        ...options,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2026-03-10',
            'User-Agent': 'divgrow-content-refresh',
            ...(options.headers || {}),
        },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
        const error = new Error(payload?.message || `GitHub request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }
    return payload;
}

export async function listRuns() {
    const payload = await githubRequest(`/actions/workflows/${WORKFLOW_FILE}/runs?per_page=30`);
    return Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
}

export function findConflict(runs, key, now = Date.now()) {
    const active = runs.find((run) => ACTIVE_STATUSES.has(run.status));
    if (active) return { type: 'active', run: active };
    const prefix = `content-refresh:${key}:`;
    const recent = runs.find((run) => {
        if (!String(run.display_title || '').startsWith(prefix)) return false;
        const finished = Date.parse(run.updated_at || run.run_started_at || run.created_at || '');
        return Number.isFinite(finished) && now - finished < COOLDOWN_MS;
    });
    return recent ? { type: 'cooldown', run: recent } : null;
}

export async function dispatchRefresh(input) {
    const requestId = crypto.randomUUID();
    const key = targetKey(input);
    const runs = await listRuns();
    const conflict = findConflict(runs, key);
    if (conflict) return { conflict, key };
    const dispatched = await githubRequest(`/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ref: 'main',
            inputs: {
                requestId,
                scope: input.scope,
                provider: input.provider || '',
                ticker: input.ticker || '',
                eventId: input.eventId ? String(input.eventId) : '',
            },
        }),
    });
    return {
        requestId,
        workflowRunId: dispatched?.workflow_run_id || null,
        key,
    };
}

export function publicRunState(run) {
    if (!run) return null;
    let status = run.status;
    if (run.status === 'completed') {
        status = run.conclusion === 'success' ? 'success' : 'failed';
    }
    return {
        workflowRunId: run.id,
        status,
        conclusion: run.conclusion || null,
        startedAt: run.run_started_at || run.created_at || null,
        finishedAt: run.status === 'completed' ? run.updated_at : null,
    };
}
