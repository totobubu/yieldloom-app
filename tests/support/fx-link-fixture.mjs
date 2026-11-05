import { createCapitalFixture } from './capital-api-fixture.mjs';
export function fxLinkFixture(uid = 'owner', ambiguous = false) {
    const f = createCapitalFixture(uid, [], {
        handlerOptions: { durableReadModels: true },
    });
    f.records.set('investmentAccounts/AC', {
        familyId: 'F',
        permissions: { owner: 'owner', editor: 'editor', viewer: 'viewer' },
    });
    f.records.set('familySpaces/F', {
        participantUids: ['owner', 'editor', 'viewer', 'admin'],
        adminUid: 'admin',
    });
    for (const [id, currency] of [
        ['K', 'KRW'],
        ['U', 'USD'],
        ...(ambiguous
            ? [
                  ['K2', 'KRW'],
                  ['U2', 'USD'],
              ]
            : []),
    ]) {
        f.records.set('investmentAccounts/AC/entries/' + id, {
            source: 'toss-pdf',
            row: {
                symbol: 'CASH',
                date: '2026-10-17',
                currency,
                amount: currency === 'KRW' ? 140000 : 100,
                exchangeRate: 1400,
                rawType: currency === 'KRW' ? '환전원화입금' : '환전외화출금',
                type: currency === 'KRW' ? 'cash_in' : 'cash_out',
                externalId: 'synthetic-source-' + id,
            },
        });
    }
    f.read = async () => {
        const r = await f.call(undefined, 'GET', { accountId: 'AC' });
        if (r.status !== 200)
            throw Error(
                `fixture read failed (${r.status}, ${r.data?.code || 'no-code'})`
            );
        return r.data;
    };
    return f;
}
