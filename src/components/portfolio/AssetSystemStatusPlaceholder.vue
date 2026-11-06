<script setup>
    import Button from 'primevue/button';
    import StitchSymbol from './StitchSymbol.vue';
</script>

<template>
    <div
        class="asset-system-status"
        role="region"
        aria-label="자산 관리 시스템 상태">
        <header>
            <h3>시스템 진단 및 동기화 상태 감시</h3>
            <span id="asset-system-status-unavailable">상태 조회 미지원</span>
        </header>
        <dl>
            <div class="system-status-card">
                <dt><StitchSymbol name="sync" />원장 색인 상태</dt>
                <dd>미확인</dd>
            </div>
            <div class="system-status-card">
                <dt><StitchSymbol name="inventory_2" />미확정 등록 대기</dt>
                <dd>미집계</dd>
            </div>
            <div class="system-status-card">
                <dt><StitchSymbol name="lan" />원격 조회 헬스</dt>
                <dd>
                    <span>미확인</span>
                    <Button
                        class="system-status-retry"
                        label="재시도"
                        aria-label="원격 조회 재시도 (미지원)"
                        aria-describedby="asset-system-status-unavailable"
                        title="상태 조회 기능이 지원되지 않습니다."
                        severity="secondary"
                        text
                        disabled />
                </dd>
            </div>
        </dl>
    </div>
</template>

<style scoped>
    .asset-system-status {
        margin-top: 32px;
        color: var(--asset-status-muted, var(--app-muted));
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 12px;
    }
    h3,
    header > span,
    dd {
        margin: 0;
        font:
            500 11px/14px 'JetBrains Mono',
            monospace;
    }
    dl {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 0;
    }
    .system-status-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
        padding: 14px;
        border-radius: 8px;
        background: var(--asset-status-surface, var(--app-surface));
        box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
    }
    dt {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--asset-status-text, var(--app-text));
        font-size: 12px;
        line-height: 16px;
    }
    dt > .stitch-symbol {
        font-size: 20px;
        color: var(--asset-status-muted, var(--app-muted));
    }
    dd {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
    }
    .system-status-retry {
        --p-button-label-font-weight: 500;
        padding: 0;
        border: 0;
        border-radius: 0;
        min-height: 14px;
        font: inherit;
    }
    :root:not(.p-dark) .asset-system-status {
        --asset-status-muted: #6e7977;
        --asset-status-text: #191c1e;
        --asset-status-surface: #ffffff;
    }
    @media (min-width: 1024px) {
        .asset-system-status {
            padding-inline: 32px;
        }
    }
    @media (max-width: 767px) {
        dl {
            grid-template-columns: 1fr;
        }
    }
</style>
