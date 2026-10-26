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
    if (
        logs.includes('"officialAnnouncements"') &&
        logs.includes('"marketUpdated"')
    ) {
        const reasons = [
            [
                'market_identity_mismatch',
                '참고 자료의 종목 또는 통화가 요청한 종목과 일치하지 않아 반영하지 않았습니다.',
            ],
            [
                'invalid_ohlc',
                '제공처의 시가·고가·저가·종가 관계가 유효하지 않아 반영하지 않았습니다.',
            ],
            [
                'rate_limited',
                '자료 제공처의 요청 제한으로 수집을 완료하지 못했습니다.',
            ],
            ['blocked', '자료 제공처가 자동 조회를 거절했습니다.'],
            [
                'ambiguous_declared_date',
                '공식 공시일을 하나로 확인하지 못해 해당 공시를 반영하지 않았습니다.',
            ],
            [
                'common_stock_announcement_not_found',
                '공식 문서에서 보통주 배당을 명확히 확인하지 못했습니다.',
            ],
            [
                'market_no_data',
                '제공처가 유효한 시세 자료를 반환하지 않았습니다.',
            ],
        ];
        const match = reasons.find(([code]) =>
            logs.includes(`"code": "${code}"`)
        );
        return {
            code: 'stock_collection_failed',
            reason:
                match?.[1] ||
                '일반 주식의 최신 자료를 수집하지 못해 이전 자료를 보존했습니다.',
            nextAction:
                '공식 공시와 참고 자료 수집 단계를 확인해 주세요. 조회 차단·요청 제한은 제공처 상태 확인 후 재시도할 수 있습니다.',
        };
    }
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
                    ['unsupported_source', 'stock_collection_failed'].includes(
                        failure?.code
                    ) && step.name === 'Refresh official data'
                        ? 'failure'
                        : step.conclusion || step.status || 'queued',
                startedAt: step.started_at || null,
                completedAt: step.completed_at || null,
                // Links are constructed from trusted IDs, never copied from logs.
                logUrl: `https://github.com/totobubu/yieldloom-app/actions/runs/${job.run_id}/job/${job.id}#step:${step.number}:1`,
            }))
    );
}
