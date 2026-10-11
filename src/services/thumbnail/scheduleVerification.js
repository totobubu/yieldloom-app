export const isConfirmedSchedule = event => ['official', 'cross_checked'].includes(event.verificationStatus);
export function partitionScheduleHistory(history) {
    const sorted = [...history].sort((a, b) => b.exDate.localeCompare(a.exDate));
    return {
        confirmed: sorted.filter(isConfirmedSchedule),
        review: sorted.filter(event => event.verificationStatus === 'needs_review'),
    };
}
