import {
    verifiedCashTime,
    verifiedExchangeFee,
} from './cash-automatic-classification.js';
export function capitalImportProjection(source, accountId) {
    const trades = source.rows
        .filter((doc) => !doc.voidedAt && doc.row?.symbol !== 'CASH')
        .map((doc) => ({
            ...doc.row,
            id: doc.id,
            accountId,
            assetId: 'ACCOUNT',
            source: doc.source || doc.row.source || 'unknown',
        }));
    const importedCash = source.rows
        .filter((doc) => !doc.voidedAt && doc.row?.symbol === 'CASH')
        .map((doc) => {
            const data = doc,
                row = data.row;
            return {
                id: doc.id,
                date: row.date,
                currency: row.currency,
                amount: row.amount,
                accountId,
                rawType: row.rawType || row.type,
                ...(row.externalId ? { externalId: row.externalId } : {}),
                ...(verifiedCashTime({ ...row, id: doc.id }, accountId)
                    ? {
                          cashTime: verifiedCashTime(
                              { ...row, id: doc.id },
                              accountId
                          ),
                      }
                    : {}),
                ...(verifiedExchangeFee({
                    ...row,
                    id: doc.id,
                    accountId,
                })
                    ? {
                          exchangeFee: verifiedExchangeFee({
                              ...row,
                              id: doc.id,
                              accountId,
                          }),
                      }
                    : {}),
                type: row.type,
                ...(row.cashTime != null &&
                !verifiedCashTime({ ...row, id: doc.id }, accountId)
                    ? { cashTimeUnverified: true }
                    : {}),
                ...((row.nativeCommission != null &&
                    Number(row.nativeCommission) !== 0) ||
                (row.exchangeFee != null &&
                    !verifiedExchangeFee({
                        ...row,
                        id: doc.id,
                        accountId,
                    }))
                    ? { exchangeFeeUnverified: true }
                    : {}),
                exchangeRate: row.exchangeRate || null,
                source: data.source,
                suggestedKind:
                    row.cashKind ||
                    (row.type === 'cash_in'
                        ? 'external_deposit'
                        : row.type === 'cash_out'
                          ? 'external_withdrawal'
                          : 'unknown'),
            };
        });
    return { trades, importedCash };
}
