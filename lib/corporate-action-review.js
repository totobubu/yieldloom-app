// Keep legacy responses conservative when the event dates are unavailable.
// A split on the first ex-date already applies to that distribution; later
// splits change the share basis between the two payments.
export function corporateActionReviewForPeriod(
    status,
    start,
    end,
    { includeStart = true } = {}
) {
    if (!Array.isArray(status?.corporateActionDates))
        return Boolean(status?.corporateActionReview);
    if (!start || !end)
        return (
            Boolean(status?.corporateActionReview) ||
            status.corporateActionDates.length > 0
        );
    return status.corporateActionDates.some(
        (date) =>
            !/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) ||
            ((includeStart ? date >= start : date > start) && date <= end)
    );
}
