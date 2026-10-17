export const blogTemplates = [
    { id: 'monthly', label: '월간 배당 결산' },
    { id: 'fire', label: 'FIRE 진행 보고서' },
    { id: 'security', label: '종목 배당 점검' },
    { id: 'reinvest', label: '재투자 비교 기록' },
    { id: 'review', label: '투자 성향·원칙 회고' },
];
const format = (n) =>
    Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
export function buildBlogDraft(template, context, privacy = {}) {
    const {
        baseline,
        currency,
        month,
        fire,
        recovery,
        comparison,
        assessment,
        notes = '',
    } = context;
    const money = (n, unit = currency) =>
        n == null
            ? '확인 필요'
            : privacy.amounts
              ? `${format(n)} ${unit}`
              : '[금액 비공개]';
    const ratio = (n) =>
        n == null
            ? '확인 필요'
            : privacy.amounts
              ? `${format(n)}%`
              : '[비율 비공개]';
    const symbol = privacy.symbols
        ? baseline?.symbols[0]?.symbol || '[종목명 입력]'
        : '[종목 비공개]';
    const timing =
        fire?.firstMonth == null
            ? '설정 기간 내 미달성 또는 계산 전'
            : privacy.amounts
              ? `${Math.floor(fire.firstMonth / 12)}년 ${fire.firstMonth % 12}개월 후 (가정)`
              : '[예상 시점 비공개]';
    const bodies = {
        monthly: [
            `[${month}] 월간 배당 결산`,
            '이번 달 돌아보기',
            `최근 12개월 저장 배당: ${money(baseline?.annualRecorded)}`,
            `배당 기록이 있는 달: ${baseline?.observedMonths ?? 0}/12개월. 기록이 없는 달은 0원으로 확정하지 않았습니다.`,
            '종목별 점검',
            `최대 기록 기여 종목: ${symbol}`,
            '전월·전년 비교: 배당 분석 화면에서 같은 기간의 기록 완전성을 확인한 뒤 작성합니다.',
            '다음 달 계획',
            '추가 투자금과 생활비 인출 계획을 점검합니다.',
        ],
        fire: [
            `[${month}] 월 배당 목표와 FIRE 진행 상황`,
            '목표와 현재',
            `가정한 시작 월 세후 배당: ${money(fire?.initialMonthly, context.fireCurrency)}`,
            `기준 시나리오 최초 목표 충족: ${timing}`,
            `기간 말 생활비 충당률: ${ratio(fire?.final.coverage)}`,
            '시나리오와 보강',
            '보수적·기준·낙관적 결과를 비교하고 추가 납입·생활비 조정 효과를 확인합니다.',
            '목표 충족은 평균 배당 기준이며 월별 지급 공백과 이후 삭감 위험을 별도로 점검합니다.',
        ],
        security: [
            `[${month}] ${symbol} 배당 점검`,
            '보유 목적',
            '[현금흐름·성장·분산 중 보유 목적 작성]',
            '배당 이력과 지급 여력',
            `최근 12개월 최대 종목 저장 배당: ${money(baseline?.symbols[0]?.amount)}`,
            '[공식 배당 공시 기준일과 출처 링크 작성]',
            '[현금흐름·배당성향·부채 및 상품 분배 구조 확인]',
            '주요 위험과 투자 조건',
            '주가 하락에 따른 배당률 상승과 실제 배당금 증가를 구분합니다.',
            '[유지·추가 매수·비중 축소 조건 작성]',
        ],
        reinvest: [
            `[${month}] 배당금 재투자 선택 기록`,
            '비교 조건',
            '동일 기간·세후 배당·주가·주당 배당 변화 가정으로 비교했습니다.',
            ...(comparison || []).map(
                (r) =>
                    `${r.label}: 기간 말 자산 ${money(r.result.final.wealth)}, 월 세후 배당 ${money(r.result.final.income)}`
            ),
            ...(!comparison
                ? ['재투자 비교를 실행한 뒤 결과를 작성합니다.']
                : []),
            '집중도와 비용 점검',
            '다른 종목 투자도 기초자산이 겹치면 분산 효과가 제한됩니다. 매도 후 교체에는 입력한 세금·비용을 차감했습니다.',
            '선택과 판단 근거',
            '[공시·지급 여력·위험을 확인한 뒤 선택 이유 작성]',
        ],
        review: [
            `[${month}] 투자 성향과 원칙 회고`,
            '모의고사 결과',
            assessment
                ? `현재 선호: ${assessment.label}. 학습 문항 ${assessment.correct}/${assessment.total}개 정답.`
                : '모의고사 완료 후 작성합니다.',
            '현금 회수 점검',
            `확인 입력 기준 현금 회수율: ${ratio(recovery?.cashRate)}`,
            ...(privacy.amounts ? assessment?.warnings || [] : []),
            '다음 투자 원칙',
            ...(assessment?.rules || [
                '비상자금·생활비·집중도를 점검하고 원칙을 작성합니다.',
            ]),
        ],
    };
    if (!bodies[template]) throw new Error('블로그 템플릿을 선택해 주세요.');
    return [
        ...bodies[template],
        '나의 메모',
        notes || '[공개할 메모를 작성하세요]',
        '기준과 계산 가정',
        `분석 기준 월: ${month}. 포트폴리오 자료 기준일: ${baseline?.dates.join(' / ') || '미확인'}.`,
        privacy.amounts
            ? context.assumptions || '계산 가정 미입력.'
            : '입력한 수치 가정은 비공개입니다. 매월 균등 배당·월초 납입·월말 재투자 및 소수주 매수 가정이며 개별 과세·매매수수료는 별도로 확인합니다.',
        '저장 배당은 세전·세후 및 내역 완전성이 확정되지 않은 기록입니다. 시뮬레이션은 입력 가정에 따른 결과이며 실제 수익이나 FIRE 달성을 보장하지 않습니다. 세금은 원천징수율 가정이며 종합과세·계좌별 과세는 별도입니다.',
        '공개 전 확인: 메모·링크·본문에 계좌정보나 공개하지 않을 금액이 없는지 검토하세요.',
    ].join('\n\n');
}
export function monthlyChartSvg(baseline, privacy = {}) {
    const rows = baseline?.months || [];
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount || 0)));
    const escape = (v) =>
        String(v).replace(
            /[&<>"']/g,
            (c) =>
                ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&apos;',
                })[c]
        );
    return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420"><rect width="960" height="420" fill="#fff"/><g fill="#172554" font-family="sans-serif"><text x="30" y="40" font-size="24">최근 12개월 저장 배당 ${privacy.amounts ? '' : '(금액 비공개)'}</text>${rows
        .map((r, i) => {
            const h =
                privacy.amounts && r.amount != null
                    ? (Math.abs(r.amount) / max) * 220
                    : 0;
            return `<rect x="${35 + i * 76}" y="${290 - h}" width="42" height="${h}" fill="${r.amount < 0 ? '#b91c1c' : '#2563eb'}"/><text x="${35 + i * 76}" y="320" font-size="12">${escape(r.month.slice(2))}</text><text x="${35 + i * 76}" y="345" font-size="11">${r.amount == null ? (r.unknown ? '금액 미확인' : '기록 없음') : privacy.amounts ? escape(format(r.amount)) : '비공개'}</text>`;
        })
        .join(
            ''
        )}<text x="30" y="390" font-size="14">통화별 저장 기록 · 누락은 0원이 아님 · 세전/세후 미확정 · 음수는 취소 초과</text></g></svg>`;
}
