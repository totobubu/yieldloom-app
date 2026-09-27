<!-- src\components\CompanyLogo.vue -->
<template>
    <div class="company-logo-wrapper bg" v-if="logoSrc && !hasError">
        <img
            :src="fullLogoSrc"
            :alt="`${companyName} logo`"
            class="company-logo"
            @error="onImageError" />
    </div>
    <div class="company-logo-wrapper" v-else-if="companyName">
        <span class="company-name-fallback">
            {{ companyName }}
        </span>
    </div>
    <div class="company-logo-wrapper" v-else></div>
</template>

<script setup>
    import { ref, computed, watch } from 'vue';
    import { getAssetUrl } from '@/utils/dataUrl';

    const props = defineProps({
        logoSrc: {
            type: String,
            default: null,
        },
        companyName: {
            type: String,
            default: '',
        },
    });

    const hasError = ref(false);

    const fullLogoSrc = computed(() => {
        if (!props.logoSrc) return '';
        return getAssetUrl(props.logoSrc);
    });

    // 이미지 로딩 실패 시 호출될 함수
    const onImageError = () => {
        console.warn(
            `로고 파일을 찾거나 로드할 수 없습니다: ${fullLogoSrc.value}`
        );
        hasError.value = true;
    };

    // [핵심 추가] prop이 변경될 때 hasError 상태를 리셋
    // 다른 종목으로 넘어갔을 때, 이전 종목의 에러 상태가 남아있는 것을 방지
    watch(
        () => props.logoSrc,
        (newSrc) => {
            // 새로운 로고 경로가 생기면 에러 상태를 초기화
            if (newSrc) {
                hasError.value = false;
            }
        }
    );
</script>
