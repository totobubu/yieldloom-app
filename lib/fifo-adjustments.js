import { createHash } from 'node:crypto';
import {
    applyFifoCorrections,
    validateFifoCorrection,
} from './fifo-asset-report.js';
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
export function emptyFifoState() {
    return { schemaVersion: 1, revision: 0, history: [] };
}
export function activeFifoCorrections(state) {
    const active = new Map();
    for (const h of state.history) {
        if (h.action === 'add') active.set(h.id, { ...h.correction, id: h.id });
        else if (h.action === 'revert') active.delete(h.targetId);
        else fail('보정 이력 형식을 확인해 주세요.', 409);
    }
    return [...active.values()];
}
export function changeFifoState(
    state,
    request,
    input,
    { uid, now = () => new Date().toISOString() } = {}
) {
    if (
        state.schemaVersion !== 1 ||
        !Number.isSafeInteger(state.revision) ||
        !Array.isArray(state.history)
    )
        fail('보정 상태를 확인해 주세요.', 409);
    if (
        !request ||
        !['add', 'revert'].includes(request.action) ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(request.requestId || '') ||
        !Number.isSafeInteger(request.expectedRevision)
    )
        fail('보정 요청과 버전을 확인해 주세요.');
    if (request.ledgerRevision !== input.ledgerRevision)
        fail('채택 장부 버전이 바뀌었습니다. 다시 조회해 주세요.', 409);
    if (
        Object.keys(request).some(
            (k) =>
                ![
                    'action',
                    'requestId',
                    'expectedRevision',
                    'ledgerRevision',
                    'correction',
                    'targetId',
                ].includes(k)
        )
    )
        fail('허용되지 않은 요청 필드입니다.');
    const fingerprint = createHash('sha256')
        .update(JSON.stringify(request))
        .digest('hex');
    const prior = state.history.find((h) => h.id === request.requestId);
    if (prior) {
        if (prior.fingerprint !== fingerprint)
            fail('같은 요청 번호의 내용이 다릅니다.', 409);
        return { state, replayed: true };
    }
    if (request.expectedRevision !== state.revision)
        fail('다른 보정이 저장되었습니다. 다시 조회해 주세요.', 409);
    if (state.history.length >= 300)
        fail(
            '보정 이력 한도에 도달했습니다. 이력을 삭제하지 않고 별도 보관 검토가 필요합니다.',
            413
        );
    const active = activeFifoCorrections(state);
    const entry = {
        id: request.requestId,
        seq: state.revision + 1,
        action: request.action,
        by: uid,
        at: now(),
        fingerprint,
    };
    if (request.action === 'add') {
        const current = applyFifoCorrections(
            input.events,
            active,
            input.accounts
        );
        const correction = validateFifoCorrection(request.correction, {
            accounts: input.accounts,
            events: current.events,
        });
        entry.correction = correction;
    } else {
        if (!active.some((c) => c.id === request.targetId))
            fail('되돌릴 활성 보정을 확인해 주세요.', 409);
        // A revert may expose a dependent stale adjustment. The GET reports that
        // state explicitly and still returns history so it can also be reverted.
        entry.targetId = request.targetId;
    }
    const next = {
        schemaVersion: 1,
        revision: state.revision + 1,
        history: [...state.history, entry],
    };
    if (Buffer.byteLength(JSON.stringify(next)) > 500000)
        fail('보정 이력 크기 한도를 초과했습니다.', 413);
    return { state: next, replayed: false };
}
