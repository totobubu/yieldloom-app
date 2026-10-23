const labels = {
    'Install dependencies': '수집 환경 준비',
    'Restore durable Content Studio state': '기존 데이터 불러오기',
    'Install collection and render browser': '수집 브라우저 준비',
    'Refresh official data': '공식 자료 수집',
    'Capture licensed fallback observation after official ticker failure':
        '대체 자료 수집',
    'Save durable Content Studio state': '수집 데이터 저장',
    'Validate generated snapshots': '결과 검증',
    'Commit public Content Studio outputs': '공개 데이터 반영',
    'Report refresh failure': '최종 결과 확인',
};
export function collectionFailure(conclusion, logs = '') {
    if (conclusion === 'cancelled')
        return {
            code: 'cancelled',
            reason: '수집 실행이 취소됐습니다.',
            nextAction: '다른 수집 실행 여부를 확인한 후 다시 요청해 주세요.',
        };
    if (conclusion === 'timed_out')
        return {
            code: 'timed_out',
            reason: '수집 실행 제한 시간을 초과했습니다.',
            nextAction:
                '실행 기록에서 지연된 단계를 확인한 후 다시 요청해 주세요.',
        };
    if (
        logs.includes(
            'ticker is not present in the official distribution or catalog index'
        )
    )
        return {
            code: 'unsupported_source',
            reason: '이 종목은 공식 배당 수집 대상 목록에 등록되어 있지 않습니다. 공식 자료 조회 전에 중단됐습니다.',
            nextAction:
                '공식 자료 출처와 수집 대상 등록이 필요합니다. 같은 요청을 반복해도 해결되지 않습니다.',
        };
    return {
        code: 'workflow_failed',
        reason: '수집 실행을 완료하지 못했습니다.',
        nextAction: '아래 단계와 GitHub 원본 로그에서 오류를 확인해 주세요.',
    };
}
export function collectionSteps(jobs, failure) {
    return jobs.flatMap((job) =>
        (job.steps || [])
            .filter((step) => labels[step.name])
            .map((step) => ({
                name: labels[step.name],
                state:
                    failure?.code === 'unsupported_source' &&
                    step.name === 'Refresh official data'
                        ? 'failure'
                        : step.conclusion || step.status || 'queued',
                startedAt: step.started_at || null,
                completedAt: step.completed_at || null,
                // Links are constructed from trusted IDs, never copied from logs.
                logUrl: `https://github.com/totobubu/yieldloom-app/actions/runs/${job.run_id}/job/${job.id}#step:${step.number}:1`,
            }))
    );
}
