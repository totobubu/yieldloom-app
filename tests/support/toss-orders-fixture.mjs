// Entirely synthetic. No production IDs, account numbers or credentials.
export const order = (orderId = 'fixture-order-1', overrides = {}) => ({
    orderId,
    symbol: 'TEST',
    side: 'BUY',
    orderType: 'LIMIT',
    timeInForce: 'DAY',
    status: 'FILLED',
    quantity: '0.1234567890123456789012345678',
    price: '12345678901234567890.123456789',
    currency: 'USD',
    orderedAt: '2026-01-02T03:04:05.123456+09:00',
    canceledAt: null,
    execution: {
        filledQuantity: '0.1234567890123456789012345678',
        averageFilledPrice: '100.0000000000000001',
        filledAmount: '12.34567890123456789',
        commission: null,
        tax: null,
        filledAt: '2026-01-02T03:04:06.000001+09:00',
        settlementDate: '2026-01-06',
    },
    unknownProviderField: { preserved: true },
    ...overrides,
});
export const page = (orders = [], nextCursor = null) =>
    JSON.stringify({
        result: { orders, nextCursor, hasNext: nextCursor !== null },
    });
