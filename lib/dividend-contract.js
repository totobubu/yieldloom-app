// UI read model only: canonical amount strings remain unchanged.
export const mapCoreDividend = (event) => ({
    id: event.eventId,
    provider_slug: event.provider,
    ticker: event.ticker,
    distribution_per_share: event.amount.raw,
    currency: event.amount.currency,
    previous_amount: null,
    average4: null,
    average12: null,
    declared_date: event.declaredDate,
    ex_date: event.exDate,
    record_date: event.recordDate,
    payable_date: event.payableDate,
    frequency: event.frequency,
    verification_status: event.verificationStatus,
    official_url: event.source.url,
});
