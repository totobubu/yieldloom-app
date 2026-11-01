// Shared allowlist only. No account, object key, source value or exception text belongs here.
const groups = [
    [
        'safety',
        '보존 자료의 허용 필드를 확인하지 못했습니다. 자료를 변경하지 말고 진단 정보를 전달해 주세요.',
        'INC_CREDENTIAL_FIELD',
    ],
    [
        'encoding',
        '증분 자료의 인코딩 무결성을 확인하지 못했습니다. 다시 조회한 뒤 반복되면 진단 정보를 전달해 주세요.',
        'INC_BASE64_FORMAT',
    ],
    [
        'marker',
        '증분 연결 정보의 무결성을 확인하지 못했습니다. 연결 자료를 변경하지 말고 진단 정보를 전달해 주세요.',
        'INC_MARKER_PREFIX_BINDING INC_MARKER_DESCRIPTOR INC_MARKER_SCOPE',
    ],
    [
        'collector_identity',
        '수집 자료의 계좌·수집 범위 무결성을 확인하지 못했습니다. 다른 계좌로 바꾸거나 다시 게시하지 말고 진단 정보를 전달해 주세요.',
        'INC_COLLECTOR_SCOPE_DECLARATION INC_COLLECTOR_MEMBER_MISSING INC_COLLECTOR_IDENTITY INC_COLLECTOR_ACCOUNT_CONFLICT INC_COLLECTOR_BINDING INC_COLLECTOR_SCOPE_MISSING INC_COLLECTOR_JSON',
    ],
    [
        'collector_coverage',
        '수집 완료 근거와 건수의 무결성을 확인하지 못했습니다. 누락분을 정상으로 처리하지 말고 진단 정보를 전달해 주세요.',
        'INC_CHECKPOINT_FORMAT INC_CHECKPOINT_PAGE_LIMIT INC_ORDER_INDEX_FORMAT INC_ORDER_INDEX_COUNTS INC_COVERAGE_COUNTS INC_COVERAGE_STATUS INC_PAGE_SET INC_OPEN_PAGE_COUNT',
    ],
    [
        'collector_pages',
        '수집 페이지의 연결·시각·무결성을 확인하지 못했습니다. 다시 조회한 뒤 반복되면 진단 정보를 전달해 주세요.',
        'INC_PAGE_SEQUENCE INC_PAGE_ACCOUNT_CURSOR INC_PAGE_TIME INC_PAGE_DIGEST INC_PAGE_PAYLOAD INC_PAGE_CONTINUATION INC_PAGE_CURSOR_CHAIN INC_PAGE_TERMINATION INC_ORDER_ID INC_PAGE_JSON INC_PAGE_ENCODING',
    ],
    [
        'collector_index',
        '수집 주문과 완료 목록의 무결성을 확인하지 못했습니다. 진단 정보를 전달해 주세요.',
        'INC_INDEX_COUNTS INC_INDEX_DUPLICATE INC_INDEX_REFERENCE_COUNT INC_INDEX_REFERENCE_VALUES',
    ],
    [
        'manifest',
        '증분 자료 목록의 무결성을 확인하지 못했습니다. 검증 기준을 변경하지 말고 진단 정보를 전달해 주세요.',
        'INC_MANIFEST_READ INC_MANIFEST_DIGEST INC_MANIFEST_FORMAT INC_MANIFEST_JSON INC_SOURCE_FILE_LIST INC_SOURCE_SET_DIGEST',
    ],
    [
        'receipt',
        '증분 완료 근거의 무결성을 확인하지 못했습니다. 완료 근거를 다시 쓰지 말고 진단 정보를 전달해 주세요.',
        'INC_RECEIPT_READ INC_RECEIPT_DIGEST INC_RECEIPT_FORMAT INC_RECEIPT_STATUS INC_RECEIPT_JSON',
    ],
    [
        'parts',
        '증분 조각 자료의 무결성을 확인하지 못했습니다. 다시 조회한 뒤 반복되면 진단 정보를 전달해 주세요.',
        'INC_BUNDLE_LIMITS INC_PART_DESCRIPTOR INC_PART_READ INC_PART_DIGEST INC_GZIP_DIGEST INC_GZIP_FORMAT',
    ],
    [
        'members',
        '보존 자료의 구성·연결 무결성을 확인하지 못했습니다. 원문이나 검증 기준을 변경하지 말고 진단 정보를 전달해 주세요.',
        'INC_ARCHIVE_DIGEST INC_ARCHIVE_FORMAT INC_BUNDLE_FORMAT INC_MEMBER_NAME INC_MEMBER_DIGEST INC_MEMBER_JSON INC_MEMBER_ENCODING INC_BUNDLE_BINDING',
    ],
    [
        'orders',
        '주문 관측의 필드·시각 무결성을 확인하지 못했습니다. 합계를 확정하지 말고 진단 정보를 전달해 주세요.',
        'INC_API_PAGE_DIGEST INC_API_PAGE_PAYLOAD INC_API_PAGE_TIME INC_API_ORDER_FORMAT INC_API_ORDER_TIME INC_API_ORDER_NUMERIC INC_API_PAGE_JSON INC_API_PAGE_ENCODING',
    ],
    [
        'dividend',
        '실제 배당 입금 근거의 무결성을 확인하지 못했습니다. 입금으로 확정하지 말고 진단 정보를 전달해 주세요.',
        'INC_DIVIDEND_FORMAT INC_DIVIDEND_SOURCE_IDENTITY INC_DIVIDEND_SOURCE_REFERENCE INC_BROWSER_BINDING INC_PAID_EVIDENCE INC_DIVIDEND_DOCUMENT INC_DIVIDEND_OBSERVATION INC_DIVIDEND_TIME INC_DIVIDEND_NUMERIC INC_DIVIDEND_DETAIL_FIELDS INC_DIVIDEND_DETAIL_CARDINALITY INC_DIVIDEND_CURRENCY_MARKER INC_DIVIDEND_DETAIL_AMOUNT INC_DIVIDEND_JSON',
    ],
    [
        'publication',
        '증분 연결 완료 확인의 무결성을 확인하지 못했습니다. 같은 자료를 임의로 재작성하지 말고 진단 정보를 전달해 주세요.',
        'INC_PUBLICATION_READBACK',
    ],
    [
        'index',
        '증분 연결 목록의 무결성을 확인하지 못했습니다. 다시 조회한 뒤 반복되면 연결 목록을 변경하지 말고 진단 정보를 전달해 주세요.',
        'INC_INDEX_LIST INC_INDEX_KEY INC_INDEX_DIGEST INC_INDEX_SCOPE INC_LEGACY_BINDING INC_INDEX_READ INC_INDEX_JSON INC_INDEX_FORMAT',
    ],
    [
        'integration',
        '개별 자료를 함께 연결하는 계좌·주문 검증을 완료하지 못했습니다. 일부 자료를 제외해 합계를 확정하지 말고 진단 정보를 전달해 주세요.',
        'INC_INTEGRATION_ACCOUNT_FORMAT INC_INTEGRATION_SEQUENCE_CONFLICT INC_INTEGRATION_COLLECTOR_BINDING INC_INTEGRATION_OWNER_CONFLICT INC_INTEGRATION_LEGACY_BINDING INC_INTEGRATION_ORDER_CONFLICT INC_INTEGRATION_FORMAT',
    ],
    [
        'configuration',
        '보고서 계좌 연결 설정을 확인하지 못했습니다. 인증 값을 복사하지 말고 진단 정보만 설정 담당자에게 전달해 주세요.',
        'INC_PROFILE_CONFIGURATION',
    ],
    [
        'increment',
        '증분 자료 검증을 완료하지 못했습니다. 다시 조회한 뒤 반복되면 진단 정보를 전달해 주세요.',
        'INC_UNCLASSIFIED',
    ],
    [
        'baseline',
        '채택 자료를 읽거나 검증하지 못했습니다. 다시 조회한 뒤 반복되면 진단 정보를 전달해 주세요.',
        'REPORT_BASELINE_READ',
    ],
    [
        'baseline',
        '채택 자료의 읽기 권한을 확인하지 못했습니다. 자료를 변경하지 말고 진단 정보를 설정 담당자에게 전달해 주세요.',
        'REPORT_BASELINE_ACCESS_READ',
    ],
    [
        'snapshot',
        '보고서 자료를 읽거나 연결하지 못했습니다. 다시 조회한 뒤 반복되면 진단 정보를 전달해 주세요.',
        'REPORT_SNAPSHOT_READ',
    ],
    [
        'input',
        '채택 자료의 계산 입력을 확인하지 못했습니다. 합계를 확정하지 말고 진단 정보를 전달해 주세요.',
        'REPORT_INPUT_INVALID',
    ],
    [
        'adjustments',
        '보정 이력을 읽거나 검증하지 못했습니다. 새로 저장하지 말고 다시 조회해 주세요.',
        'REPORT_ADJUSTMENTS_READ',
    ],
    [
        'adjustment_write',
        '보정 저장 결과를 확인하지 못했습니다. 새로고침으로 확인하거나 같은 입력으로 재시도해 주세요.',
        'REPORT_ADJUSTMENTS_WRITE',
    ],
    [
        'report',
        '보고서를 확인하지 못했습니다. 잠시 후 다시 조회하고 반복되면 진단 정보를 전달해 주세요.',
        'REPORT_UNAVAILABLE',
    ],
];

export const reportDiagnostics = Object.freeze(
    Object.fromEntries(
        groups.flatMap(([stage, message, codes]) =>
            codes.split(' ').map((code) => [
                code,
                Object.freeze({
                    stage,
                    message,
                    status:
                        code.endsWith('_READ') ||
                        code === 'REPORT_ADJUSTMENTS_WRITE' ||
                        code === 'INC_PROFILE_CONFIGURATION' ||
                        code === 'REPORT_UNAVAILABLE'
                            ? 503
                            : 409,
                }),
            ])
        )
    )
);
const trustedErrors = new WeakSet();
const definition = (code) =>
    typeof code === 'string' && Object.hasOwn(reportDiagnostics, code)
        ? reportDiagnostics[code]
        : null;
const commonCode = (code) =>
    code === 'REPORT_BASELINE_ACCESS_READ'
        ? 'REPORT_STORAGE_DENIED'
        : code.startsWith('INC_')
          ? 'INCREMENT_INTEGRITY_FAILED'
          : 'REPORT_INTEGRITY_FAILED';

export function reportDiagnosticError(diagnosticCode) {
    const info = definition(diagnosticCode);
    if (!info) throw Error('지원하지 않는 진단 코드입니다.');
    const error = Object.assign(
        new Error(
            diagnosticCode.startsWith('INC_')
                ? '증분 자료 무결성을 확인하지 못했습니다.'
                : info.message
        ),
        {
            code: commonCode(diagnosticCode),
            status: info.status,
            diagnosticCode,
        }
    );
    trustedErrors.add(error);
    return error;
}

// Preserve only failures created by this module. Never retain raw exception text/cause.
export function withReportDiagnostic(code, task) {
    const replace = (error) => {
        throw trustedErrors.has(error) ? error : reportDiagnosticError(code);
    };
    try {
        const result = task();
        return result && typeof result.then === 'function'
            ? result.catch(replace)
            : result;
    } catch (error) {
        return replace(error);
    }
}

const requestPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function normalizeReportDiagnostic(value) {
    if (
        !value ||
        value.version !== 1 ||
        typeof value.requestId !== 'string' ||
        !requestPattern.test(value.requestId)
    )
        return null;
    const info = definition(value.code);
    if (!info || info.stage !== value.stage) return null;
    return {
        version: 1,
        code: value.code,
        stage: info.stage,
        requestId: value.requestId,
    };
}
export function publicReportFailure(
    error,
    requestId,
    fallback = 'REPORT_UNAVAILABLE'
) {
    const code = trustedErrors.has(error)
        ? error.diagnosticCode
        : error?.code === 'INCREMENT_INTEGRITY_FAILED'
          ? 'INC_UNCLASSIFIED'
          : fallback;
    const info = definition(code) || definition('REPORT_UNAVAILABLE');
    const diagnostic = normalizeReportDiagnostic({
        version: 1,
        code: definition(code) ? code : 'REPORT_UNAVAILABLE',
        stage: info.stage,
        requestId,
    });
    return {
        status: info.status,
        error: info.message,
        code: commonCode(code),
        ...(diagnostic ? { diagnostic } : {}),
    };
}
export function reportDiagnosticText(value) {
    const d = normalizeReportDiagnostic(value);
    return d
        ? `진단 버전: ${d.version}\n코드: ${d.code}\n단계: ${d.stage}\n요청 ID: ${d.requestId}`
        : '';
}
