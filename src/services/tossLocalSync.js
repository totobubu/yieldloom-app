// Connector is an existing, trusted same-computer read-only collector adapter.
// No browser launch, host permissions, credentials, polling, or remote CDP here.
export function createTossLocalSync({
    connector = null,
    ledgerClient,
    context,
    onSaved = () => {},
    onState = () => {},
}) {
    let generation = 0,
        running = false;
    const emit = (phase, note) => onState({ phase, note });
    const assertContext = (start, run) => {
        const current = context();
        if (
            run !== generation ||
            current.user !== start.user ||
            current.accountId !== start.accountId
        )
            throw Error(
                '로그인 또는 선택 계좌가 변경되어 업데이트를 중단했습니다.'
            );
    };
    const inspect = async (start, run) => {
        if (!connector)
            throw Error(
                '같은 컴퓨터의 기존 토스 수집기가 아직 이 화면에 연결되지 않았습니다. 토스 창만 여는 것으로 자동 연결되지는 않습니다.'
            );
        const status = await connector.status();
        assertContext(start, run);
        if (
            status.connected !== true ||
            status.readOnly !== true ||
            status.accountVerified !== true ||
            status.accountId !== start.accountId
        )
            throw Error(
                '토스 연결과 선택한 남편·아내 계좌의 일치를 확인해 주세요.'
            );
        return status;
    };
    async function check() {
        if (running) throw Error('업데이트가 진행 중입니다.');
        const start = context(),
            run = generation;
        if (!start.user || !['wife', 'husband'].includes(start.accountId))
            throw Error('관리자 로그인 후 계좌를 선택해 주세요.');
        await inspect(start, run);
        emit('connected', '읽기 전용 연결과 대상 계좌를 확인했습니다.');
    }
    async function update() {
        if (running) throw Error('업데이트가 진행 중입니다.');
        const start = context(),
            run = generation;
        if (!start.user || !['wife', 'husband'].includes(start.accountId))
            throw Error('관리자 로그인 후 계좌를 선택해 주세요.');
        running = true;
        try {
            emit('checking', '연결과 계좌를 확인하고 있습니다.');
            await inspect(start, run);
            // Collector returns its existing unacknowledged batch first on resume.
            // It receives no Firebase token or broker session from this client.
            const batch = await connector.nextBatch({
                accountId: start.accountId,
                readOnly: true,
            });
            assertContext(start, run);
            if (!batch) {
                emit(
                    'idle',
                    '새로 가져올 증분이 없습니다. 전체 수집 완료를 뜻하지 않습니다.'
                );
                return;
            }
            if (
                batch.accountId !== start.accountId ||
                !Array.isArray(batch.observations) ||
                !batch.observations.length ||
                batch.observations.length > 100 ||
                batch.observations.some(
                    (o) =>
                        o.accountId !== start.accountId ||
                        ![
                            'TOSS_TRANSACTION',
                            'TOSS_ORDER',
                            'TOSS_EXPECTED_DIVIDEND',
                        ].includes(o.kind)
                )
            )
                throw Error('수집 배치의 계좌·출처·건수를 확인해 주세요.');
            const command = {
                accountId: batch.accountId,
                batchId: batch.batchId,
                observations: batch.observations,
                checkpoint: batch.checkpoint,
            };
            // Conservative boundary: never send cookie/auth/session payloads to cloud.
            if (
                /(?:"?(?:cookie|cookies|authorization|access[_-]?token|refresh[_-]?token|session[_-]?(?:id|token)|password)"?\s*[:=]|\bbearer\s+)/i.test(
                    JSON.stringify(batch).replaceAll('\\"', '"')
                )
            )
                throw Error('인증 정보가 포함된 배치는 전송하지 않습니다.');
            emit(
                'previewing',
                '기존 배치 API에서 원문 중복과 보존 형식을 확인하고 있습니다.'
            );
            const preview = await ledgerClient.mutate(start.user, 'POST', {
                ...command,
                action: 'batch-preview',
            });
            assertContext(start, run);
            if (
                !preview.canonicalUnchanged ||
                typeof preview.fingerprint !== 'string'
            )
                throw Error('원문 보존 미리보기 응답을 확인해 주세요.');
            emit(
                'saving',
                '대조 원문만 저장하고 있습니다. 거래값은 자동 채택하지 않습니다.'
            );
            const result = await ledgerClient.mutate(start.user, 'POST', {
                ...command,
                action: 'batch-commit',
                fingerprint: preview.fingerprint,
            });
            assertContext(start, run);
            if (!result.canonicalUnchanged)
                throw Error('원문 보존 응답을 확인해 주세요.');
            // Apply cloud result even if collector acknowledgement subsequently fails.
            onSaved(result);
            await connector.acknowledge({
                accountId: start.accountId,
                batchId: batch.batchId,
                checkpoint: batch.checkpoint,
            });
            assertContext(start, run);
            emit(
                'saved',
                '이번 증분 배치의 원문을 저장했습니다. 나머지 증분은 다음 클릭으로 이어서 가져옵니다. 승인·원금 확정과는 별개입니다.'
            );
            return result;
        } catch (error) {
            if (run === generation) emit('error', error.message);
            throw error;
        } finally {
            running = false;
        }
    }
    return {
        check,
        update,
        cancel() {
            generation++;
            emit('disconnected', '연결 상태를 다시 확인해 주세요.');
        },
    };
}
