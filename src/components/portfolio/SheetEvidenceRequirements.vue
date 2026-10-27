<script setup>
    import { sheetEvidenceGuide } from '../../services/sheetEvidenceGuide.js';
    defineProps({ holds: { type: Array, default: () => [] } });
</script>
<template>
    <p class="requirements-note">
        아래는 값을 확정하기 위한 확인 기준입니다. 모든 자료의 확보나 검증
        완료를 뜻하지 않습니다. 원문값·비교 후보·관리자 확정값은 별도로
        보존합니다.
    </p>
    <div
        v-if="holds.length"
        class="requirements-scroll"
        role="region"
        aria-label="보류 항목 판단 근거 표"
        tabindex="0">
        <table>
            <caption>
                보류 항목별 데이터와 확인 방법
            </caption>
            <thead>
                <tr>
                    <th scope="col">검토 항목</th>
                    <th scope="col">비교할 저장 자료</th>
                    <th scope="col">판별에 필요한 데이터</th>
                    <th scope="col">검증 방법과 사용자 확인 범위</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="hold in holds" :key="hold.id">
                    <th scope="row">
                        <strong>{{ hold.title }}</strong>
                        <p>{{ hold.count }}{{ hold.unit }}</p>
                        <small>기존 보고서 설명: {{ hold.note }}</small>
                    </th>
                    <td>{{ sheetEvidenceGuide(hold.id).compare }}</td>
                    <td>{{ sheetEvidenceGuide(hold.id).required }}</td>
                    <td>
                        <p>
                            <strong>자동 검증</strong>
                            {{ sheetEvidenceGuide(hold.id).automated }}
                        </p>
                        <p>
                            <strong>사용자 확인</strong>
                            {{ sheetEvidenceGuide(hold.id).user }}
                        </p>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p v-else>
        이 보고서에 보류 항목이 없습니다. 전체 검증 완료를 뜻하지 않습니다.
    </p>
</template>
<style scoped>
    .requirements-note,
    small {
        color: var(--p-text-muted-color);
    }
    .requirements-scroll {
        overflow-x: auto;
        max-width: 100%;
        margin-block: 1rem;
    }
    .requirements-scroll:focus-visible {
        outline: 2px solid var(--p-primary-color);
        outline-offset: 2px;
    }
    table {
        width: 100%;
        min-width: 950px;
        border-collapse: collapse;
        font-size: 0.875rem;
    }
    caption {
        text-align: left;
        font-weight: 600;
        padding-block: 0.5rem;
    }
    th,
    td {
        padding: 0.8rem;
        border: 1px solid var(--p-content-border-color);
        vertical-align: top;
        text-align: left;
        overflow-wrap: anywhere;
    }
    thead th {
        background: var(--p-content-hover-background);
    }
    tbody th {
        width: 20%;
        font-weight: 400;
    }
    td {
        width: 25%;
    }
    p {
        margin-block: 0 0.5rem;
    }
</style>
