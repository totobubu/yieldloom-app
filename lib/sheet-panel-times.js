// Source timestamp/quantity projection only. Selected list identity is never
// attached to the actually displayed panel. No monetary-text parsing here.
export function buildPanelSourceTimeItems({
    records,
    accountId,
    archiveKey,
    sha256,
    recordsPath = 'records',
}) {
    if (
        !['wife', 'husband'].includes(accountId) ||
        !/^[a-f0-9]{64}$/.test(sha256 || '') ||
        !['records', 'found'].includes(recordsPath)
    )
        throw Error('Panel provenance required');
    const fields = {
        reservedAt: '예약 시간',
        orderedUiAt: '주문 시간',
        executionDateTime: '(?:구매|판매|체결) 시간',
        failedAt: '실패 시간',
        cancelledAt: '취소 시간',
    };
    return records.flatMap((record, i) => {
        if (
            (record.accountRole && record.accountRole !== accountId) ||
            (record.status !== 'detail-visible' &&
                !(recordsPath === 'found' && record.status == null)) ||
            typeof record.raw !== 'string'
        )
            return [];
        const symbol = record.raw.match(
            /^\s*([A-Z][A-Z0-9.-]{0,11})(?=\s|·|$)/
        )?.[1];
        const sourceStatus = record.raw.match(
            /(?:구매|판매|매도)\s*(?:완료|실패|취소)/
        )?.[0];
        if (!symbol || !sourceStatus) return [];
        const type = sourceStatus.startsWith('구매') ? 'BUY' : 'SELL';
        const times = Object.entries(fields).flatMap(([role, label]) => {
            const pattern = new RegExp(
                `(${label})\\s*(\\d{4})년\\s*(\\d{1,2})월\\s*(\\d{1,2})일\\s*((?:[01]?\\d|2[0-3])):([0-5]\\d)(?::([0-5]\\d)(\\.\\d{1,3})?)?`
            );
            const m = record.raw.match(pattern);
            if (!m) return [];
            const value = `${m[2]}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')} ${m[5].padStart(2, '0')}:${m[6]}${m[7] ? ':' + m[7] + (m[8] || '') : ''}`;
            return [
                {
                    role,
                    field: m[1],
                    value,
                    timeZone: null,
                },
            ];
        });
        if (!times.length) return [];
        const eventDates = [...new Set(times.map((t) => t.value.slice(0, 10)))];
        const eventDate = (
            times.find((t) => t.role === 'executionDateTime') || times[0]
        ).value.slice(0, 10);
        const quantity = record.raw.match(
            /(?:구매|판매|매도) 수량\s*([\d,.]+)\s*주/
        );
        return [
            {
                id: `${sha256}:${recordsPath}:${i}`,
                accountId,
                symbol,
                type,
                eventDate,
                ...(eventDates.length > 1 ? { eventDates } : {}),
                sourceStatus,
                quantity: quantity
                    ? Number(quantity[1].replaceAll(',', ''))
                    : null,
                times,
                directIdentityVerified: false,
                source: {
                    archiveKey,
                    file: 'stored-ui-batch',
                    sha256,
                    path: `${recordsPath}[${i}].raw`,
                    integrity: 'R2_RESPONSE_DIGEST',
                },
            },
        ];
    });
}
