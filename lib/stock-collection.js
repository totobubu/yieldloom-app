import { randomUUID } from 'node:crypto';
import { isPortfolioAdmin } from './portfolio-admin.js';
import { isDelisted } from './security-status.js';
import { normalizeSymbol, validSymbol } from './thumbnail-projection.js';

const repo = 'totobubu/yieldloom-app';
const workflow = 'content-studio-provider-refresh.yml';
const production = 'https://yieldloom-app.vercel.app';
const fail = (message, status) => {
    throw Object.assign(new Error(message), { status });
};
export function stockCollectionHandler({
    verify,
    knownSymbol,
    marketForSymbol = () => '',
    fetcher = fetch,
    token = () => process.env.CONTENT_STUDIO_GITHUB_TOKEN,
    uuid = randomUUID,
}) {
    const pending = new Map();
    async function github(path, options = {}) {
        const key = token();
        if (!key) fail('데이터 수집 연결이 아직 설정되지 않았습니다.', 503);
        const response = await fetcher(
            `https://api.github.com/repos/${repo}${path}`,
            {
                ...options,
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${key}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    ...options.headers,
                },
                signal: AbortSignal.timeout(15000),
            }
        );
        if (!response.ok)
            fail(
                '수집 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
                502
            );
        return response.status === 204 ? null : response.json();
    }
    const runs = async () =>
        (
            await github(
                `/actions/workflows/${workflow}/runs?branch=main&event=workflow_dispatch&per_page=100`
            )
        ).workflow_runs || [];
    const prefix = (symbol) => `content-refresh:ticker:${symbol}_`;
    async function collectionSummary(requestId) {
        try {
            const response = await fetcher(
                `${production}/content-studio/system-logs.json?collection=${encodeURIComponent(requestId)}`,
                { cache: 'no-store', signal: AbortSignal.timeout(10000) }
            );
            if (!response.ok) throw new Error('collection log unavailable');
            const payload = await response.json();
            const run = payload.runs?.find(
                (row) => row.requestId === requestId
            );
            if (!run) throw new Error('collection log missing');
            return {
                collectionMode:
                    run.collectionMode === 'official_discovery'
                        ? 'official_discovery'
                        : 'official',
                collectionOutcome:
                    run.status === 'partial' ? 'partial' : 'success',
                addedObservations: Number(run.addedObservations) || 0,
            };
        } catch {
            return {
                collectionMode: 'official',
                collectionOutcome: 'success',
                addedObservations: 0,
            };
        }
    }
    async function start(symbol) {
        const active = (await runs()).find(
            (run) =>
                run.display_title?.startsWith(prefix(symbol)) &&
                run.status !== 'completed'
        );
        if (active)
            return {
                symbol,
                requestId: active.display_title.slice(
                    'content-refresh:ticker:'.length
                ),
                state: 'collecting',
            };
        const requestId = `${symbol}_${uuid()}`;
        const market = marketForSymbol(symbol);
        await github(`/actions/workflows/${workflow}/dispatches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ref: 'main',
                inputs: { scope: 'ticker', ticker: symbol, market, requestId },
            }),
        });
        return { symbol, requestId, state: 'queued' };
    }
    async function status(symbol, requestId) {
        const run = (await runs()).find(
            (row) => row.display_title === `content-refresh:ticker:${requestId}`
        );
        if (!run) return { symbol, requestId, state: 'queued' };
        const runUrl = `https://github.com/${repo}/actions/runs/${run.id}`;
        if (run.status !== 'completed')
            return { symbol, requestId, state: 'collecting', runUrl };
        if (run.conclusion !== 'success')
            return {
                symbol,
                requestId,
                state: 'failed',
                runUrl,
                error: '종목 수집을 완료하지 못했습니다. 수집 기록을 확인해 주세요.',
            };
        const commits = await github('/commits?sha=main&per_page=30');
        const commit = commits.find((row) =>
            row.commit?.message
                ?.split('\n')
                .includes(`Refresh-Request: ${requestId}`)
        );
        if (!commit) return { symbol, requestId, state: 'publishing', runUrl };
        const releaseResponse = await fetcher(
            `${production}/app-release.json?collection=${encodeURIComponent(requestId)}`,
            { cache: 'no-store', signal: AbortSignal.timeout(10000) }
        );
        const release = releaseResponse.ok ? await releaseResponse.json() : {};
        let ready = release.commit === commit.sha;
        if (!ready && /^[a-f0-9]{40}$/.test(release.commit || '')) {
            const comparison = await github(
                `/compare/${commit.sha}...${release.commit}`
            );
            ready = ['ahead', 'identical'].includes(comparison.status);
        }
        if (!ready) return { symbol, requestId, state: 'publishing', runUrl };
        // A preview or Pages client must also read the newly published production data.
        const response = await fetcher(
            `${production}/api/thumbnail-data?ticker=${encodeURIComponent(symbol)}&rivals=&collection=${encodeURIComponent(requestId)}`,
            { cache: 'no-store', signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok)
            fail(
                '수집은 끝났지만 최신 종목 정보를 불러오지 못했습니다. 상태 확인을 다시 눌러 주세요.',
                502
            );
        const data = await response.json();
        if (data.ticker?.symbol !== symbol)
            fail('수집 결과의 종목이 일치하지 않습니다.', 502);
        const summary = await collectionSummary(requestId);
        return { symbol, requestId, state: 'ready', runUrl, data, ...summary };
    }
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            if (!['POST', 'GET'].includes(req.method))
                return res
                    .status(405)
                    .json({ error: '지원하지 않는 요청입니다.' });
            const user = await verify(req, req.method === 'POST');
            if (!isPortfolioAdmin(user))
                fail('관리자만 데이터를 수집할 수 있습니다.', 403);
            const input = req.method === 'POST' ? req.body : req.query;
            const symbol = normalizeSymbol(input?.symbol);
            if (!validSymbol(symbol) || !knownSymbol(symbol))
                fail('등록된 종목을 선택해 주세요.', 400);
            if (isDelisted(symbol))
                fail('상장폐지 종목은 새로 수집하지 않습니다.', 400);
            if (req.method === 'GET') {
                const requestId = String(input?.requestId || '');
                if (
                    !requestId.startsWith(`${symbol}_`) ||
                    !/^[A-Z0-9.-]+_[a-f0-9-]{36}$/.test(requestId)
                )
                    fail('수집 요청을 확인해 주세요.', 400);
                return res.status(200).json(await status(symbol, requestId));
            }
            if (!pending.has(symbol)) {
                if (pending.size >= 32)
                    fail(
                        '수집 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
                        429
                    );
                const task = start(symbol).finally(() =>
                    pending.delete(symbol)
                );
                pending.set(symbol, task);
            }
            return res.status(202).json(await pending.get(symbol));
        } catch (error) {
            const status =
                error.status ||
                ([
                    'auth/id-token-expired',
                    'auth/argument-error',
                    'auth/id-token-revoked',
                ].includes(error.code)
                    ? 401
                    : 502);
            return res.status(status).json({
                error: error.status
                    ? error.message
                    : '수집 요청을 확인하지 못했습니다. 로그인 상태와 연결을 확인해 주세요.',
            });
        }
    };
}
