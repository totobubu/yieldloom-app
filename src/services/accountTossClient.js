import { apiUrl } from './apiUrl.js';
import { createSharedRequest, joinSharedRequest } from './sharedRequest.js';

const messages = {
    AUTHENTICATION_REQUIRED: '로그인을 확인하세요.',
    ACCESS_DENIED: '선택 계좌의 접근 권한이 없습니다.',
    OWNER_REQUIRED: '명의자 본인만 연결을 설정할 수 있습니다.',
    CONNECTION_ACCESS_DENIED: '이 연결을 사용할 권한이 없습니다.',
    EXECUTION_NOT_CONFIGURED:
        '실제 API 실행 환경과 비밀 저장소가 아직 준비되지 않았습니다.',
    ACCOUNT_VERIFICATION_REQUIRED: '선택 계좌의 연결을 확인하세요.',
    STALE_BINDING:
        '계좌 또는 연결 상태가 변경됐습니다. 상태를 다시 확인하세요.',
    CONNECTION_ROTATED:
        '인증정보가 교체됐습니다. 연결을 해제한 뒤 다시 등록하세요.',
    AUTHORIZATION_REQUIRED:
        'API 인증 또는 허용 IP 확인이 필요합니다. 자동 재발급하지 않습니다.',
    CONNECTION_REQUIRED: '연결을 먼저 등록하세요.',
    ALREADY_CONNECTED: '이미 연결된 계좌입니다. 상태를 다시 확인하세요.',
};
export const connectionMessage = (code) =>
    messages[code] ||
    '연결 요청을 완료하지 못했습니다. 상태를 확인한 뒤 다시 시도하세요.';

export function createAccountTossClient({
    getUser,
    fetcher = fetch,
    endpoint = apiUrl('/api/toss-portfolio'),
}) {
    let session;
    const pending = new Map();
    function clear() {
        for (const task of pending.values()) task.controller.abort();
        pending.clear();
    }
    async function request(accountId, body, signal) {
        const user = getUser();
        if (session !== user) {
            clear();
            session = user;
        }
        if (!user)
            throw new Error(connectionMessage('AUTHENTICATION_REQUIRED'));
        const work = async (sharedSignal) => {
            try {
                const token = await user.getIdToken();
                if (getUser() !== user || sharedSignal?.aborted)
                    throw new DOMException('취소됨', 'AbortError');
                const response = await fetcher(
                    body
                        ? endpoint
                        : `${endpoint}?${new URLSearchParams({ accountId })}`,
                    {
                        method: body ? 'POST' : 'GET',
                        cache: 'no-store',
                        signal: sharedSignal,
                        headers: {
                            Authorization: `Bearer ${token}`,
                            ...(body
                                ? { 'Content-Type': 'application/json' }
                                : {}),
                        },
                        ...(body
                            ? { body: JSON.stringify({ ...body, accountId }) }
                            : {}),
                    }
                );
                const result = await response.json();
                if (getUser() !== user || sharedSignal?.aborted)
                    throw new DOMException('취소됨', 'AbortError');
                if (!response.ok)
                    throw new Error(connectionMessage(result.error));
                return result;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                // Unknown network/provider text is never shown or logged.
                if (Object.values(messages).includes(error.message))
                    throw error;
                throw new Error(connectionMessage());
            }
        };
        if (body) return work(signal);
        let task = pending.get(accountId);
        if (!task) {
            task = createSharedRequest(work);
            pending.set(accountId, task);
            task.promise
                .finally(() => {
                    if (pending.get(accountId) === task)
                        pending.delete(accountId);
                })
                .catch(() => {});
        }
        return joinSharedRequest(task, signal);
    }
    return {
        user: getUser,
        clear,
        status: (id, signal) => request(id, undefined, signal),
        act: (id, body, signal) => request(id, body, signal),
    };
}
