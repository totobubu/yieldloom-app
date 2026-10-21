<script setup>
    import { onScopeDispose, ref, useId } from 'vue';
    import Button from 'primevue/button';
    import Popover from 'primevue/popover';
    defineProps({
        label: { type: String, required: true },
        text: { type: String, required: true },
    });
    const trigger = ref(null),
        popup = ref(null),
        content = ref(null),
        opened = ref(false);
    const descriptionId = `${useId()}-description`;
    let closeTimer,
        pinned = false;
    function cancelClose() {
        clearTimeout(closeTimer);
    }
    function show(event, pin = false) {
        cancelClose();
        if (pin) pinned = true;
        popup.value?.show(event, trigger.value?.$el);
    }
    function hide() {
        cancelClose();
        pinned = false;
        popup.value?.hide();
    }
    function scheduleClose() {
        cancelClose();
        closeTimer = setTimeout(() => {
            const active = document.activeElement;
            if (
                !pinned &&
                active !== trigger.value?.$el &&
                !content.value?.contains(active)
            )
                hide();
        }, 180);
    }
    onScopeDispose(cancelClose);
    defineExpose({ hide });
</script>
<template>
    <span
        class="info-help"
        @mouseenter="show($event)"
        @mouseleave="scheduleClose"
        @focusout="scheduleClose">
        <Button
            ref="trigger"
            icon="pi pi-info-circle"
            :aria-label="label"
            :aria-describedby="descriptionId"
            :aria-expanded="opened"
            severity="secondary"
            text
            rounded
            @click="show($event, true)" />
        <span :id="descriptionId" class="studio-sr-only">{{ text }}</span>
        <Popover
            ref="popup"
            :aria-label="label"
            @show="opened = true"
            @hide="
                opened = false;
                pinned = false;
            ">
            <div
                ref="content"
                class="info-help-content"
                @mouseenter="cancelClose"
                @mouseleave="scheduleClose"
                @focusin="cancelClose"
                @focusout="scheduleClose">
                <p>{{ text }}</p>
                <slot />
            </div>
        </Popover>
    </span>
</template>
<style scoped>
    .info-help {
        display: inline-flex;
        align-items: center;
    }
    .info-help > .p-button {
        min-width: 44px;
        min-height: 44px;
    }
    .info-help-content {
        max-width: min(340px, 75vw);
        font-size: 14px;
        line-height: 1.7;
    }
    .info-help-content > p {
        margin: 0;
    }
    .info-help-content :deep(p + p) {
        margin-top: 10px;
    }
</style>
