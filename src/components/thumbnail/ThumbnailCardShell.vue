<script setup lang="ts">
    import { computed, inject } from 'vue';
    import {
        cardDimensions,
        cardPresentationKey,
        normalizeCardPresentation,
    } from '@/services/thumbnail/cardPresentation';
    const presentation = inject(
        cardPresentationKey,
        computed(() => normalizeCardPresentation())
    );
    const dimensions = computed(() => cardDimensions(presentation.value));
    withDefaults(
        defineProps<{
            title: string;
            badge?: string;
            contextLabel?: string;
            dateLabel?: string;
            dateValue?: string;
        }>(),
        {
            badge: '',
            contextLabel: '배당 카드',
            dateLabel: '기준일',
            dateValue: '',
        }
    );
</script>

<template>
    <section
        class="thumbnail-card-shell"
        :class="[
            `thumbnail-ratio-${presentation.aspectRatio}`,
            `thumbnail-template-${presentation.template}`,
        ]"
        :style="{
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
        }"
        :data-aspect-ratio="presentation.aspectRatio"
        :data-card-template="presentation.template">
        <header class="thumbnail-card-header">
            <slot name="header">
                <div class="thumbnail-card-title-stack">
                    <div class="thumbnail-card-context">
                        <span>TOTTOBUBU DIVIDEND SCHEDULE</span>
                        <i aria-hidden="true">•</i>
                        <span class="thumbnail-card-context-label">{{
                            contextLabel
                        }}</span>
                    </div>
                    <div class="thumbnail-card-title-group">
                        <h1>{{ title }}</h1>
                        <span v-if="badge" class="thumbnail-card-badge">{{
                            badge
                        }}</span>
                    </div>
                </div>
                <div v-if="dateValue" class="thumbnail-card-date">
                    <small>{{ dateLabel }}</small>
                    <b>{{ dateValue }}</b>
                </div>
            </slot>
        </header>
        <main class="thumbnail-card-content">
            <slot />
            <slot name="hero" />
            <slot name="content01" />
            <slot name="content02" />
            <slot name="content03" />
        </main>
        <footer class="thumbnail-card-footer">
            <span class="thumbnail-card-footer-note">
                <slot name="footer" />
            </span>
            <span class="thumbnail-card-footer-brand"
                >토또부부의 배당 스튜디오</span
            >
        </footer>
    </section>
</template>
