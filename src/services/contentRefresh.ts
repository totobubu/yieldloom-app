export type RefreshInput =
    | { scope: 'all' }
    | { scope: 'provider'; provider: string }
    | { scope: 'ticker'; ticker: string }
    | { scope: 'ex_date'; exDate: string }
    | { scope: 'render'; eventId: number };

export type RefreshStatus = {
    workflowRunId: number | null;
    status: string;
    conclusion?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
};

const configuredBase = String(
    import.meta.env.VITE_CONTENT_REFRESH_API_BASE || ''
).replace(/\/$/, '');

function apiUrl(path: string) {
    if (!configuredBase) {
        throw new Error('갱신 API 주소가 설정되지 않았습니다.');
    }
    return `${configuredBase}${path}`;
}

async function payload(response: Response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || `갱신 요청에 실패했습니다 (${response.status})`);
    }
    return body;
}

export async function startRefresh(input: RefreshInput) {
    const response = await fetch(apiUrl('/api/content-refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    return payload(response) as Promise<{
        requestId: string;
        workflowRunId: number | null;
    }>;
}

export async function readRefreshStatus(
    requestId: string,
    workflowRunId: number | null
) {
    const query = new URLSearchParams({ requestId });
    if (workflowRunId) query.set('workflowRunId', String(workflowRunId));
    const response = await fetch(
        apiUrl(`/api/content-refresh/status?${query.toString()}`),
        { cache: 'no-store' }
    );
    return payload(response) as Promise<RefreshStatus>;
}

export async function runRefresh(
    input: RefreshInput,
    onStatus?: (status: RefreshStatus) => void,
    pollMilliseconds = 5000
) {
    const started = await startRefresh(input);
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
        const status = await readRefreshStatus(
            started.requestId,
            started.workflowRunId
        );
        onStatus?.(status);
        if (status.status === 'success') return status;
        if (status.status === 'failed') {
            throw new Error('갱신 작업이 실패했습니다. 시스템 로그를 확인하세요.');
        }
        await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
    }
    throw new Error('갱신 작업이 제한 시간 안에 끝나지 않았습니다.');
}
