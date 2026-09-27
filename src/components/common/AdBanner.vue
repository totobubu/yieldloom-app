<template>
  <div class="ad-banner-container my-4 flex justify-content-center">
    <ins
      class="adsbygoogle"
      :style="adStyle"
      :data-ad-client="adClient"
      :data-ad-slot="adSlot"
      :data-ad-format="adFormat"
      :data-full-width-responsive="fullWidthResponsive"
    ></ins>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';

const props = defineProps({
  adClient: {
    type: String,
    default: 'ca-pub-2016661117155246', // index.html에 있는 클라이언트 ID
  },
  adSlot: {
    type: String,
    required: true, // 구글 애드센스에서 광고 단위를 생성하면 발급되는 고유 ID
  },
  adFormat: {
    type: String,
    default: 'auto',
  },
  fullWidthResponsive: {
    type: String,
    default: 'true',
  },
  adStyle: {
    type: Object,
    default: () => ({ display: 'block' }),
  },
});

onMounted(() => {
  try {
    // Vue SPA 특성상 컴포넌트가 마운트될 때마다 광고를 갱신해 주어야 합니다.
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (e) {
    console.error('AdSense error:', e);
  }
});
</script>

<style scoped>
.ad-banner-container {
  width: 100%;
  min-height: 100px; /* 광고가 로드되기 전 레이아웃 시프트를 방지 */
  background-color: transparent;
}
</style>
