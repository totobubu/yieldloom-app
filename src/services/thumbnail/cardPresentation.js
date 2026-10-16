export const cardPresentationKey = Symbol('thumbnail-card-presentation');
export const cardAspectRatios = [
    { value: 'square', label: '정사각형 · 1:1', width: 720, height: 720 },
    { value: 'wide', label: '와이드 · 16:9', width: 1280, height: 720 },
    { value: 'story', label: '스토리 · 9:16', width: 720, height: 1280 },
];
export const cardTemplates = [
    { value: 'classic', label: '기본' },
    { value: 'paper', label: '페이퍼' },
    { value: 'navy', label: '네이비' },
];
export const shareCardKinds = [
    'summary',
    'comparison',
    'rival',
    'calendar',
    'entry-efficiency',
];

export function normalizeCardPresentation(value = {}) {
    return {
        aspectRatio: cardAspectRatios.some(
            (item) => item.value === value?.aspectRatio
        )
            ? value.aspectRatio
            : 'square',
        template: cardTemplates.some((item) => item.value === value?.template)
            ? value.template
            : 'classic',
    };
}

export function cardDimensions(value) {
    const normalized = normalizeCardPresentation(value);
    const { width, height } = cardAspectRatios.find(
        (item) => item.value === normalized.aspectRatio
    );
    return { width, height };
}

export function artworkSuffix(value) {
    const { aspectRatio, template } = normalizeCardPresentation(value);
    return aspectRatio === 'square' && template === 'classic'
        ? ''
        : `_${aspectRatio}_${template}`;
}

export function artworkFilename(symbol, kind, value) {
    const name = String(symbol)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-');
    if (!shareCardKinds.includes(kind))
        throw new Error('지원하지 않는 카드 종류입니다.');
    return `${name}_${kind}${artworkSuffix(value)}.png`;
}
