import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
    watch,
} from 'vue';

// The document is the default scroll owner. Full-screen dialogs can supply
// their content root without creating a second vertical scroller in the table.
export function useDocumentLedgerWindow(
    rows,
    region,
    table,
    scrollRoot = null
) {
    const start = ref(0),
        heights = shallowRef(new Map());
    let frame = 0,
        observer,
        activeScrollTarget,
        stopWatching;
    const scrollTarget = () => scrollRoot?.value || window;
    const scrollPosition = () => scrollRoot?.value?.scrollTop ?? window.scrollY;
    const viewportTop = () =>
        scrollRoot?.value?.getBoundingClientRect().top || 0;
    const regionTop = () =>
        region.value.getBoundingClientRect().top -
        viewportTop() +
        scrollPosition();
    const offsets = computed(() => {
        const positions = [0];
        for (const row of rows.value)
            positions.push(
                positions.at(-1) + (heights.value.get(row.id) || 64)
            );
        return positions;
    });
    const renderedRows = computed(() =>
        rows.value.slice(start.value, start.value + 100)
    );
    const paddingTop = computed(() => offsets.value[start.value] || 0);
    const paddingBottom = computed(
        () =>
            offsets.value.at(-1) -
            (offsets.value[start.value + renderedRows.value.length] || 0)
    );
    function refresh() {
        frame = 0;
        if (
            !region.value ||
            !table.value ||
            !region.value.getClientRects().length
        )
            return;
        const measured = new Map(heights.value);
        let changed = false;
        for (const element of table.value.querySelectorAll(
            'tr[data-ledger-index]'
        )) {
            const row = rows.value[Number(element.dataset.ledgerIndex)],
                height = element.getBoundingClientRect().height;
            if (
                row &&
                height > 0 &&
                Math.abs((measured.get(row.id) || 64) - height) > 1
            ) {
                measured.set(row.id, height);
                changed = true;
            }
        }
        if (changed) heights.value = measured;
        const y = Math.max(0, scrollPosition() - regionTop());
        let left = 0,
            right = rows.value.length;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (offsets.value[mid] < y) left = mid + 1;
            else right = mid;
        }
        const index = Math.min(
            Math.max(0, rows.value.length - 100),
            Math.floor(Math.max(0, left - 20) / 25) * 25
        );
        if (index !== start.value) {
            start.value = index;
            nextTick(schedule);
        }
    }
    function schedule() {
        if (!frame) frame = requestAnimationFrame(refresh);
    }
    function rowAttributes({ context }) {
        return {
            'data-ledger-index': start.value + context.index,
            'aria-rowindex': start.value + context.index + 2,
        };
    }
    async function jump(end = false) {
        start.value = end ? Math.max(0, rows.value.length - 100) : 0;
        await nextTick();
        if (!region.value) return;
        const top = regionTop();
        const height = scrollRoot?.value?.clientHeight || window.innerHeight;
        scrollTarget().scrollTo({
            top: end ? top + offsets.value.at(-1) - height + 100 : top,
            behavior: 'instant',
        });
        schedule();
    }
    watch(rows, () => {
        start.value = 0;
        heights.value = new Map();
        nextTick(schedule);
    });
    onMounted(() => {
        window.addEventListener('resize', schedule, { passive: true });
        stopWatching = watch(
            [region, table, () => scrollRoot?.value],
            () => {
                activeScrollTarget?.removeEventListener('scroll', schedule);
                observer?.disconnect();
                activeScrollTarget = scrollTarget();
                activeScrollTarget.addEventListener('scroll', schedule, {
                    passive: true,
                });
                if (typeof ResizeObserver !== 'undefined' && table.value) {
                    observer = new ResizeObserver(schedule);
                    observer.observe(table.value);
                }
                nextTick(schedule);
            },
            { immediate: true, flush: 'post' }
        );
    });
    onBeforeUnmount(() => {
        stopWatching?.();
        activeScrollTarget?.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        observer?.disconnect();
        if (frame) cancelAnimationFrame(frame);
    });
    return {
        start,
        renderedRows,
        paddingTop,
        paddingBottom,
        rowAttributes,
        jump,
    };
}
