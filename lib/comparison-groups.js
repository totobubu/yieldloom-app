export const comparisonSections = [
    {
        value: 'underlying',
        label: '기초자산별 ETF 비교',
        icon: 'pi pi-sitemap',
        description:
            '같은 기초자산을 참조하는 ETF의 전략과 수익 구조를 비교하세요.',
    },
    {
        value: 'similar',
        label: '유사 ETF 비교',
        icon: 'pi pi-clone',
        description:
            '전략 → 방향 → 배당 여부 → 지급 주기 순서로 ETF를 좁혀 비교하세요.',
    },
    {
        value: 'theme',
        label: '테마 비교',
        icon: 'pi pi-th-large',
        description: '키워드·업종·기술 테마별 본주와 ETF를 살펴보세요.',
    },
];
export const comparisonThemes = [
    {
        value: 'm7',
        label: 'M7 (매그니피센트 7)',
        group: '키워드 테마',
        members: [
            'AAPL',
            'MSFT',
            'GOOGL',
            'GOOG',
            'AMZN',
            'NVDA',
            'META',
            'TSLA',
        ],
        pattern: /\bM7\b|magnificent\s*(?:7|seven)|매그니피센트\s*7/i,
        description:
            'Apple · Microsoft · Alphabet · Amazon · NVIDIA · Meta · Tesla 및 M7 명칭 ETF',
    },
    {
        value: 'semiconductors',
        label: '반도체',
        group: '업종 테마',
        members: [
            'NVDA',
            'AMD',
            'AVGO',
            'INTC',
            'MU',
            'TSM',
            'ARM',
            'QCOM',
            'ASML',
            'AMAT',
            'LRCX',
            'MRVL',
        ],
        pattern: /semiconductor|반도체/i,
        description:
            '반도체 종목을 기초자산으로 참조하거나 상품명에 반도체가 명시된 ETF',
    },
    {
        value: 'fang',
        label: 'FANG',
        group: '키워드 테마',
        members: ['META', 'AMZN', 'NFLX', 'GOOG', 'GOOGL'],
        pattern: /\bFANG(?:\+|PLUS)?\b|팡\s*플러스|팡플러스/i,
        description: 'Meta · Amazon · Netflix · Alphabet 및 FANG 명칭 ETF',
    },
    {
        value: 'faang',
        label: 'FAANG',
        group: '키워드 테마',
        members: ['META', 'AAPL', 'AMZN', 'NFLX', 'GOOG', 'GOOGL'],
        pattern: /\bFAANG\b/i,
        description:
            'Meta · Apple · Amazon · Netflix · Alphabet 및 FAANG 명칭 ETF',
    },
    {
        value: 'finance',
        label: '금융',
        group: '업종 테마',
        members: [
            'JPM',
            'BAC',
            'C',
            'WFC',
            'GS',
            'MS',
            'V',
            'MA',
            'AXP',
            'PYPL',
            'HOOD',
            'SOFI',
            'BRK-B',
        ],
        pattern: /financial|\bbanks?\b|fintech|금융|은행|핀테크/i,
        description: '은행·금융 서비스·결제 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'travel',
        label: '여행·항공·레저',
        group: '업종 테마',
        members: [
            'ABNB',
            'BKNG',
            'EXPE',
            'CCL',
            'RCL',
            'NCLH',
            'MAR',
            'HLT',
            'DAL',
            'UAL',
            'AAL',
            'LUV',
            'WYNN',
            'LVS',
        ],
        pattern:
            /travel|tourism|airlines?|cruise|hotels?|leisure|여행|항공(?!\s*우주)|관광|호텔|레저|크루즈/i,
        description:
            '여행·예약·항공·숙박·레저 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'healthcare',
        label: '헬스케어·바이오',
        group: '업종 테마',
        members: [
            'LLY',
            'NVO',
            'UNH',
            'JNJ',
            'PFE',
            'MRNA',
            'ABBV',
            'AMGN',
            'ISRG',
            'BMY',
        ],
        pattern: /health\s*care|biotech|pharma|헬스케어|바이오|제약|의료/i,
        description: '의료·제약·바이오 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'energy',
        label: '에너지·원유',
        group: '업종 테마',
        members: ['XOM', 'CVX', 'COP', 'OXY', 'SLB'],
        pattern: /energy|crude|\boil\b|에너지|원유|석유|천연가스/i,
        description: '에너지 기업·원유·가스 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'real-estate',
        label: '부동산·리츠',
        group: '업종 테마',
        members: ['O', 'AMT', 'PLD', 'SPG', 'EQIX', 'DLR'],
        pattern: /real\s*estate|\breits?\b|부동산|리츠/i,
        description: '부동산·리츠 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'consumer',
        label: '소비재·유통',
        group: '업종 테마',
        members: [
            'AMZN',
            'WMT',
            'COST',
            'TGT',
            'HD',
            'LOW',
            'NKE',
            'SBUX',
            'MCD',
            'KO',
            'PEP',
        ],
        pattern: /consumer|retail|소비재|유통|리테일/i,
        description: '소비재·유통 기업 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'electric-vehicles',
        label: '전기차·배터리',
        group: '업종 테마',
        members: ['TSLA', 'RIVN', 'NIO', 'LI', 'XPEV', 'LCID', 'ALB'],
        pattern:
            /electric\s*vehicles?|batter(?:y|ies)|전기차|배터리|이차전지|2차전지/i,
        description: '전기차·배터리 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'industrials',
        label: '산업재·항공우주',
        group: '업종 테마',
        members: ['BA', 'CAT', 'DE', 'GE', 'RTX', 'LMT', 'NOC', 'RKLB', 'ASTS'],
        pattern: /industrial|aerospace|defense|산업재|항공우주|방산/i,
        description: '산업재·우주·방산 기업 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'ai',
        label: 'AI·로봇',
        group: '기술·투자 테마',
        members: ['NVDA', 'AMD', 'PLTR', 'AI', 'PATH', 'SOUN', 'SYM'],
        pattern: /\bAI\b|artificial\s*intelligence|robotics?|인공지능|로봇/i,
        description: 'AI·로봇 관련 대표 기초자산 또는 상품명 키워드',
    },
    {
        value: 'cloud',
        label: '클라우드·소프트웨어',
        group: '기술·투자 테마',
        members: [
            'MSFT',
            'AMZN',
            'GOOG',
            'GOOGL',
            'ORCL',
            'CRM',
            'NOW',
            'SNOW',
            'ADBE',
            'DDOG',
        ],
        pattern: /cloud|software|클라우드|소프트웨어/i,
        description: '클라우드·소프트웨어 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'cybersecurity',
        label: '사이버 보안',
        group: '기술·투자 테마',
        members: ['CRWD', 'PANW', 'ZS', 'FTNT', 'S'],
        pattern: /cyber|사이버\s*보안|정보보안/i,
        description: '사이버 보안 관련 기초자산 또는 상품명 키워드',
    },
    {
        value: 'crypto',
        label: '가상자산·블록체인',
        group: '기술·투자 테마',
        members: [
            'COIN',
            'MSTR',
            'MARA',
            'RIOT',
            'CLSK',
            'IREN',
            'HUT',
            'CIFR',
        ],
        pattern:
            /bitcoin|ethereum|blockchain|crypto|비트코인|이더리움|블록체인|가상자산|암호화폐/i,
        description: '가상자산·채굴 기업 관련 기초자산 또는 상품명 키워드',
    },
];
export function themeMatch(product, theme) {
    if (!theme) return null;
    if (product.kind === 'underlying-stock')
        return theme.members.includes(product.symbol)
            ? { kind: 'constituent', label: `테마 구성 종목 ${product.symbol}` }
            : null;
    if (theme.members.includes(product.underlying))
        return { kind: 'underlying', label: `기초자산 ${product.underlying}` };
    const issuerPrefix =
        /^(?:뉴욕\s*멜론은행|뱅크\s*오브\s*몬트리올|Bank of (?:Montreal|New York(?: Mellon)?)|BNY(?: Mellon)?)\s*/i;
    const name = [product.koName, product.longName]
        .filter(Boolean)
        .map((name) => name.replace(issuerPrefix, ''))
        .join(' ');
    const match = theme.pattern?.exec(name);
    return match ? { kind: 'name', label: `상품명 키워드: ${match[0]}` } : null;
}
export function themeProducts(products, theme) {
    return products
        .filter((row) => themeMatch(row, theme))
        .sort((a, b) => {
            const aStock = a.kind === 'underlying-stock';
            const bStock = b.kind === 'underlying-stock';
            if (aStock && bStock)
                return (
                    theme.members.indexOf(a.symbol) -
                    theme.members.indexOf(b.symbol)
                );
            return Number(bStock) - Number(aStock);
        });
}
