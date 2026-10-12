<script setup>
import { useHead } from '@vueuse/head';

useHead({ title: '이용 안내 · Yieldloom' });
</script>

<template>
    <article class="legal-page">
        <p class="eyebrow">YIELDLOOM</p>
        <h1>이용 안내</h1>
        <section>
            <h2>정보의 성격</h2>
            <p>Yieldloom은 공개된 시장 및 배당 정보를 보기 쉽게 정리해 제공합니다. 투자 권유, 매매 신호 또는 세무·법률 자문이 아니며, 최종 투자 판단과 확인 책임은 이용자에게 있습니다.</p>
        </section>
        <section>
            <h2>데이터 출처와 갱신</h2>
            <p>배당 정보는 검증된 공개 원장과 출처 링크를 기준으로 표시합니다. 데이터의 갱신 시각과 상태를 확인하고, 공시·운용사 원문으로 다시 확인해 주세요.</p>
        </section>
        <section>
            <h2>개인정보</h2>
            <p>공개 티커 탐색과 카드 공유 기능은 로그인 없이 사용할 수 있습니다. 광고 또는 분석 도구를 도입하는 경우, 적용 전 별도의 개인정보 처리방침과 동의 안내를 게시합니다.</p>
        </section>
    </article>
</template>

<style scoped>
.legal-page{max-width:760px;margin:32px auto 72px;line-height:1.75;color:var(--app-text)}.eyebrow{margin:0;color:var(--app-accent);font-size:.78rem;font-weight:800;letter-spacing:.14em}.legal-page h1{font-size:2rem;letter-spacing:-.04em}.legal-page section{margin-top:26px;padding-top:20px;border-top:1px solid var(--app-border-subtle)}.legal-page h2{font-size:1.05rem}.legal-page p{color:var(--app-muted)}
</style>
