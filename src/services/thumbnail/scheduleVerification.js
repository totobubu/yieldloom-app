export const isConfirmedSchedule = event => ['official', 'cross_checked'].includes(event.verificationStatus);
export function currentScheduleEvent(events, reference) {
    const next = events.filter(event => event.exDate >= reference)
        .sort((a, b) => a.exDate.localeCompare(b.exDate))[0];
    return next ?? [...events].sort((a, b) => b.exDate.localeCompare(a.exDate))[0] ?? null;
}
export function partitionScheduleHistory(history) {
    const sorted = [...history].sort((a, b) => b.exDate.localeCompare(a.exDate));
    return {
        confirmed: sorted.filter(isConfirmedSchedule),
        review: sorted.filter(event => event.verificationStatus === 'needs_review'),
    };
}
