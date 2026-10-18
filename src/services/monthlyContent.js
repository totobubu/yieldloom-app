import {
    validateMonthlyStatement,
    compareMonthlyStatements,
} from './monthlyStatement.js';
import { buildBlogDraft } from './investmentEditorial.js';

export function monthlyContentContext(statement, previous) {
    const current = validateMonthlyStatement(statement);
    let comparison, old;
    if (previous) {
        old = validateMonthlyStatement(previous);
        comparison = compareMonthlyStatements(current, old);
    }
    return {
        statement: current,
        previousStatement: old,
        statementComparison: comparison,
        month: current.month,
        currency: current.currency,
    };
}
export function monthlyBlogText(
    statement,
    previous,
    { amounts = false, notes = '' } = {}
) {
    return buildBlogDraft(
        'monthly',
        { ...monthlyContentContext(statement, previous), notes },
        { amounts, symbols: false }
    );
}
const escapeXml = (value) =>
    String(value).replace(
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
export function monthlyCardSvg(statement, previous, { amounts = false } = {}) {
    const { statement: current, statementComparison: comparison } =
        monthlyContentContext(statement, previous);
    const money = (n) =>
        n == null
            ? '미확인'
            : amounts
              ? n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
              : '비공개';
    const lines = [
        ['MONTHLY DIVIDEND', 96, 32, '#93b4ff'],
        [`${current.month} 배당 결산`, 190, 66, '#ffffff'],
        ['확인된 저장 배당', 310, 36, '#c4cfe4'],
        [
            current.recordCount
                ? `${money(current.knownAmount)} ${current.currency}`
                : '기록 없음',
            410,
            68,
            '#ffffff',
        ],
        [
            `배당·취소 ${current.recordCount}건 / 금액 미확인 ${current.unknownCount}건`,
            510,
            30,
            '#c4cfe4',
        ],
        [
            previous
                ? `${previous.month} 대비 증감 ${money(comparison.difference)} ${current.currency}`
                : '이전 결산을 연결해 비교하세요',
            620,
            32,
            '#c4cfe4',
        ],
        [`자료 확인일 ${current.asOf}`, 760, 28, '#93b4ff'],
        [
            '공식 수령액·세후 금액·전체 기록의 완전성을 확정하지 않습니다.',
            860,
            24,
            '#c4cfe4',
        ],
        ['토또부부 배당 스튜디오', 980, 30, '#ffffff'],
    ];
    const text = lines
        .map(([label, y, size, color]) => {
            const units = [...label].reduce(
                (sum, char) => sum + (char.charCodeAt(0) < 128 ? 0.65 : 1),
                0
            );
            const fontSize = Math.min(size, Math.floor(936 / units));
            return `<text x="72" y="${y}" font-family="sans-serif" font-size="${fontSize}" fill="${color}">${escapeXml(label)}</text>`;
        })
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" rx="40" fill="#101e38"/><path d="M72 680H1008" stroke="#38527e"/>${text}</svg>`;
}
