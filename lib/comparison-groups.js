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
            '기준 ETF와 전략·방향이 같은 상품을 비교하세요. 레버리지 ETF는 배수도 맞춥니다.',
    },
    {
        value: 'theme',
        label: '테마 비교',
        icon: 'pi pi-th-large',
        description: '관심 테마의 종목을 기초자산으로 하는 ETF를 살펴보세요.',
    },
];
export const comparisonThemes = [
    {
        value: 'm7',
        label: 'M7 (매그니피센트 7)',
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
        description:
            'Apple · Microsoft · Alphabet · Amazon · NVIDIA · Meta · Tesla',
    },
    {
        value: 'semiconductors',
        label: '반도체',
        members: ['NVDA', 'AMD', 'AVGO', 'INTC', 'MU', 'TSM', 'ARM'],
        description: 'NVIDIA · AMD · Broadcom · Intel · Micron · TSMC · Arm',
    },
];
export function canCompareSimilar(reference) {
    return Boolean(
        reference &&
            ['income', 'leveraged', 'single-stock'].includes(
                reference.strategy
            ) &&
            ['long', 'inverse'].includes(reference.direction) &&
            (reference.strategy !== 'leveraged' ||
                Number.isFinite(reference.leverage))
    );
}
export function similarProducts(products, reference) {
    if (!canCompareSimilar(reference)) return [];
    return products
        .filter((row) => {
            if (
                row.symbol === reference.symbol ||
                row.strategy !== reference.strategy ||
                row.direction !== reference.direction
            )
                return false;
            // Leverage is a comparison requirement for daily leveraged products.
            // For other strategies, absent leverage metadata does not imply 1x exposure.
            if (reference.strategy === 'leveraged')
                return row.leverage === reference.leverage;
            return (
                row.leverage == null ||
                reference.leverage == null ||
                row.leverage === reference.leverage
            );
        })
        .sort(
            (a, b) =>
                Number(b.underlying === reference.underlying) -
                    Number(a.underlying === reference.underlying) ||
                a.symbol.localeCompare(b.symbol)
        );
}
export function themeProducts(products, theme) {
    if (!theme) return [];
    const members = new Set(theme.members);
    return products.filter((row) => members.has(row.underlying));
}
