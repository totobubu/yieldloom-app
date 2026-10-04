export type ProviderCollectionSchedule = {
    displayName: string;
    label: string;
    rocCollection: 'official_column' | 'not_published';
};

// These labels mirror content-studio-provider-refresh.yml. Times are KST.
export const providerCollectionSchedules: Record<string, ProviderCollectionSchedule> = {
    yieldmax: { displayName: 'YieldMax', label: '평일 07:15', rocCollection: 'official_column' },
    defiance: { displayName: 'Defiance ETFs', label: '평일 07:25', rocCollection: 'official_column' },
    roundhill: { displayName: 'Roundhill Investments', label: '평일 07:35', rocCollection: 'not_published' },
    rex: { displayName: 'REX Shares', label: '평일 07:45', rocCollection: 'not_published' },
    globalx: { displayName: 'Global X ETFs', label: '평일 09:05', rocCollection: 'not_published' },
    amplify: { displayName: 'Amplify ETFs', label: '평일 09:15', rocCollection: 'not_published' },
    neos: { displayName: 'NEOS Investments', label: '평일 09:25', rocCollection: 'not_published' },
    jpmorgan: { displayName: 'J.P. Morgan Asset Management', label: '평일 09:35', rocCollection: 'not_published' },
    schwab: { displayName: 'Schwab Asset Management', label: '평일 09:45', rocCollection: 'not_published' },
    firsttrust: { displayName: 'First Trust', label: '매월 1–7일 11:05', rocCollection: 'not_published' },
    graniteshares: { displayName: 'GraniteShares', label: '매월 8–14일 11:15', rocCollection: 'official_column' },
    ishares: { displayName: 'iShares by BlackRock', label: '매월 15–21일 11:25', rocCollection: 'not_published' },
    kurv: { displayName: 'Kurv Investment Management', label: '매월 22–28일 11:35', rocCollection: 'not_published' },
    proshares: { displayName: 'ProShares', label: '매월 1–7일 11:45', rocCollection: 'not_published' },
    statestreet: { displayName: 'State Street SPDR ETFs', label: '매월 1–7일 11:55', rocCollection: 'not_published' },
};

export function providerSchedule(slug: string): ProviderCollectionSchedule | null {
    return providerCollectionSchedules[slug] || null;
}
