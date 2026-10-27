<script setup>
    import { onBeforeUnmount, ref, watch } from 'vue';
    const props = defineProps({
        container: { type: Object, default: null },
        region: { type: Object, default: null },
        scrollRoot: { type: Object, default: null },
    });
    const host = ref(null);
    let dispose = () => {};
    watch(
        () => [props.container, props.region, host.value, props.scrollRoot],
        ([container, region, overlay, scrollRoot]) => {
            dispose();
            if (!container || !region || !overlay) return;
            const scroller = container.querySelector(
                '.p-datatable-table-container'
            );
            const table = scroller?.querySelector('table');
            const head = table?.querySelector('thead');
            if (!head) return;
            let frame = 0,
                dirty = true;
            const refresh = () => {
                frame = 0;
                if (dirty) {
                    const clone = table.cloneNode(false);
                    overlay.className = `${container.querySelector('.p-datatable')?.className || 'p-datatable'} document-ledger-header`;
                    clone.style.width = `${table.getBoundingClientRect().width}px`;
                    clone.style.tableLayout = 'fixed';
                    const clonedHead = head.cloneNode(true);
                    clonedHead.style.position = 'static';
                    const originals = head.querySelectorAll('th');
                    clonedHead.querySelectorAll('th').forEach((cell, index) => {
                        const width =
                            originals[index].getBoundingClientRect().width;
                        cell.style.width = `${width}px`;
                        cell.style.minWidth = `${width}px`;
                        cell.style.maxWidth = `${width}px`;
                        cell.dataset.originalColumn = index;
                        if (
                            cell.classList.contains('p-datatable-frozen-column')
                        ) {
                            cell.style.position = 'sticky';
                        }
                    });
                    for (const node of [
                        clonedHead,
                        ...clonedHead.querySelectorAll('*'),
                    ]) {
                        node.removeAttribute('id');
                        node.removeAttribute('aria-describedby');
                        if (node.matches('button, a, input, [tabindex]'))
                            node.setAttribute('tabindex', '-1');
                    }
                    clone.append(clonedHead);
                    overlay.replaceChildren(clone);
                    dirty = false;
                }
                const bounds = scroller.getBoundingClientRect();
                const regionBounds = region.getBoundingClientRect();
                let top = scrollRoot
                    ? scrollRoot.getBoundingClientRect().top
                    : Math.max(
                          0,
                          document
                              .querySelector('.studio-header')
                              ?.getBoundingClientRect().bottom || 0
                      );
                const toolbar = scrollRoot?.querySelector('.approval-toolbar');
                const toolbarBounds = toolbar?.getBoundingClientRect();
                if (
                    toolbarBounds &&
                    toolbarBounds.top <= top + 1 &&
                    toolbarBounds.bottom > top
                )
                    top = toolbarBounds.bottom;
                const height = head.getBoundingClientRect().height;
                const visible =
                    regionBounds.top < top &&
                    regionBounds.bottom > top + height;
                Object.assign(overlay.style, {
                    display: visible ? 'block' : 'none',
                    left: `${Math.max(0, bounds.left)}px`,
                    top: `${top}px`,
                    width: `${Math.min(bounds.width, window.innerWidth - Math.max(0, bounds.left))}px`,
                });
                overlay.scrollLeft = scroller.scrollLeft;
            };
            const schedule = () => {
                if (!frame) frame = requestAnimationFrame(refresh);
            };
            const rebuild = () => {
                dirty = true;
                schedule();
            };
            const resize = new ResizeObserver(rebuild);
            resize.observe(scroller);
            resize.observe(head);
            const mutations = new MutationObserver(rebuild);
            mutations.observe(head, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
            });
            const section = scrollRoot?.querySelector('.ledger-list');
            if (section) mutations.observe(section, { childList: true });
            const sort = (event) => {
                const cell = event.target.closest('th[data-original-column]');
                if (cell)
                    head.querySelectorAll('th')[
                        Number(cell.dataset.originalColumn)
                    ]?.click();
            };
            overlay.addEventListener('click', sort);
            scroller.addEventListener('scroll', schedule, { passive: true });
            const scrollTarget = scrollRoot || window;
            scrollTarget.addEventListener('scroll', schedule, {
                passive: true,
            });
            window.addEventListener('resize', rebuild, { passive: true });
            schedule();
            dispose = () => {
                cancelAnimationFrame(frame);
                resize.disconnect();
                mutations.disconnect();
                overlay.removeEventListener('click', sort);
                scroller.removeEventListener('scroll', schedule);
                scrollTarget.removeEventListener('scroll', schedule);
                window.removeEventListener('resize', rebuild);
                overlay.replaceChildren();
            };
        },
        { flush: 'post' }
    );
    onBeforeUnmount(() => dispose());
</script>
<template>
    <Teleport :to="scrollRoot || 'body'">
        <div
            ref="host"
            class="p-datatable document-ledger-header"
            aria-hidden="true" />
    </Teleport>
</template>
<style scoped>
    .document-ledger-header {
        display: none;
        position: fixed;
        z-index: 29;
        overflow: hidden;
        background: var(--p-content-background);
        border-bottom: 1px solid var(--p-content-border-color);
        box-shadow: 0 3px 8px rgb(0 0 0 / 8%);
    }
</style>
