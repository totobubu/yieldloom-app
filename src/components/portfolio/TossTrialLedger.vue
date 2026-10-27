<script setup>
    import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
    import {
        buildTossTrialRows,
        filterTossTrialRows,
        projectTrialReviewReport,
    } from '../../../lib/toss-trial-view.js';
    import { createSheetReportClient } from '@/services/sheetReports.js';
    import { useDocumentLedgerWindow } from '@/composables/useDocumentLedgerWindow.js';
    const props = defineProps({
        observations: { type: Array, default: () => [] },
        sheetRows: { type: Array, default: () => [] },
        busy: Boolean,
        user: { type: Object, default: null },
        labels: { type: Object, default: () => ({}) },
    });
    const emit = defineEmits(['inspect']);
    const account = ref(''),
        search = ref(''),
        sort = ref('date'),
        direction = ref(-1),
        selectedId = ref(null);
    const region = ref(null),
        table = ref(null);
    const client = createSheetReportClient();
    const checkpoint = shallowRef(null),
        reportAccount = ref('wife'),
        reportError = ref(''),
        reportLoading = ref(false);
    let reportGeneration = 0;
    const review = computed(() =>
        checkpoint.value ? projectTrialReviewReport(checkpoint.value) : []
    );
    const reportHash = computed(
        () => checkpoint.value?.integrity?.checkpointSha256 || ''
    );
    const all = computed(() =>
        buildTossTrialRows(
            [...props.observations, ...(checkpoint.value?.observations || [])],
            props.sheetRows
        )
    );
    const filtered = computed(() =>
        filterTossTrialRows(all.value, {
            account: account.value,
            search: search.value,
            sort: sort.value,
            direction: direction.value,
        })
    );
    const { renderedRows, paddingTop, paddingBottom, jump, start } =
        useDocumentLedgerWindow(filtered, region, table);
    const selected = computed(() =>
        all.value.find((r) => r.id === selectedId.value)
    );
    const text = (value) =>
        value == null || value === '' ? '미확인' : String(value);
    const sourceName = (kind) =>
        ({
            TOSS_ORDER: '토스 주문',
            TOSS_TRANSACTION: '토스 거래',
            TOSS_EXPECTED_DIVIDEND: '토스 배당 상세',
            PDF: '기존 PDF 관측 · 발행 출처 별도 검토',
        })[kind] || kind;
    function sortBy(field) {
        if (sort.value === field) direction.value *= -1;
        else {
            sort.value = field;
            direction.value = -1;
        }
    }
    async function loadReport(refresh = false) {
        const current = ++reportGeneration;
        checkpoint.value = null;
        reportError.value = '';
        reportLoading.value = false;
        if (!props.user) return;
        reportLoading.value = true;
        try {
            const value = await client.load(
                props.user,
                reportAccount.value,
                'followup',
                { refresh }
            );
            projectTrialReviewReport(value);
            if (current === reportGeneration) checkpoint.value = value;
        } catch (error) {
            if (current === reportGeneration)
                reportError.value =
                    error.code === 'REPORT_STORAGE_DENIED'
                        ? '기존 비공개 R2 읽기 권한이 거부됐습니다. 자료를 빈 결과로 처리하지 않습니다.'
                        : error.message;
        } finally {
            if (current === reportGeneration) reportLoading.value = false;
        }
    }
    watch(
        () => [props.user, props.user?.email, props.user?.emailVerified],
        () => {
            client.clear();
            loadReport();
        },
        { immediate: true }
    );
    watch(reportAccount, () => loadReport());
    watch(account, (value) => {
        if (value) reportAccount.value = value;
    });
    onBeforeUnmount(() => {
        reportGeneration++;
        client.clear();
        checkpoint.value = null;
    });
</script>

<template>
    <section class="toss-trial" aria-label="토스 원본 중심 시험 장부">
        <h2>토스 주문·거래 · 시험 장부</h2>
        <p>
            토스 관측을 독립 행으로 표시합니다. 원문 → 정규화 검토 → 시트 대조
            후보 → 관리자 승인 상태를 구분하며, 시트 행에 맞춰 주문을 합치지
            않습니다.
        </p>
        <p class="scope-note">
            현재 연결된 저장 관측만 표시합니다. 전체 토스 이력·개별 체결 검증
            완료가 아닙니다. 주문과 거래내역은 별도 행이며, 같은 금융사건인지
            불명확한 기록을 합산하지 않습니다.
        </p>
        <div class="controls">
            <label
                >토스 계좌
                <select v-model="account" aria-label="토스 계좌">
                    <option value="">전체</option>
                    <option value="wife">아내 · 토스</option>
                    <option value="husband">남편 · 토스</option>
                </select></label
            >
            <label
                >전체 토스 검색
                <input
                    v-model="search"
                    type="search"
                    aria-label="전체 토스 검색"
            /></label>
            <Button label="토스 처음 행" size="small" @click="jump(false)" />
            <Button label="토스 마지막 행" size="small" @click="jump(true)" />
        </div>
        <p role="status">
            토스 관측 {{ all.length }}행 · 검색 {{ filtered.length }}행 · 표시
            {{ filtered.length ? start + 1 : 0 }}–{{
                start + renderedRows.length
            }}. 내부 증거 ID는 증권사 영구 거래 ID가 아닙니다.
        </p>
        <p v-if="!all.length">
            연결된 토스/PDF 관측이 없습니다. 아래 시트 참고 행을 토스 확정
            거래로 승격하지 않습니다.
        </p>
        <div v-else ref="region" class="broker-table-region">
            <table
                ref="table"
                class="broker-table"
                :aria-rowcount="filtered.length + 1">
                <caption>
                    독립 원본 관측과 시트 보조 대조
                </caption>
                <thead>
                    <tr>
                        <th scope="col">계좌</th>
                        <th
                            v-for="field in [
                                { key: 'date', label: '원문 날짜' },
                                { key: 'symbol', label: '티커' },
                                { key: 'kind', label: '원문 종류' },
                                { key: 'quantity', label: '수량' },
                                { key: 'amountUsd', label: '관측 금액($)' },
                            ]"
                            :key="field.key"
                            scope="col"
                            :aria-sort="
                                sort === field.key
                                    ? direction === 1
                                        ? 'ascending'
                                        : 'descending'
                                    : 'none'
                            ">
                            <button type="button" @click="sortBy(field.key)">
                                {{ field.label }}
                            </button>
                        </th>
                        <th scope="col">검증·승인</th>
                        <th scope="col">시트 참고</th>
                        <th scope="col">근거</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if="paddingTop" aria-hidden="true">
                        <td
                            colspan="9"
                            :style="{
                                height: paddingTop + 'px',
                                padding: 0,
                                border: 0,
                            }"></td>
                    </tr>
                    <tr
                        v-for="(row, index) in renderedRows"
                        :key="row.id"
                        :data-ledger-index="start + index">
                        <td>
                            {{ row.accountId === 'wife' ? '아내' : '남편' }}
                        </td>
                        <td>{{ text(row.date) }}</td>
                        <td>{{ row.symbol }} · {{ row.type }}</td>
                        <td>
                            {{ sourceName(row.kind)
                            }}<small v-if="row.observation.uiLinkVerified"
                                >보존 후속 보고서 발췌</small
                            >
                        </td>
                        <td>{{ text(row.quantity) }}</td>
                        <td>{{ text(row.amountUsd) }}</td>
                        <td>
                            <strong v-if="row.identityConflict"
                                >동일 증거 ID 충돌 · 원문 선택 보류</strong
                            ><span>{{ row.eventStatus }}</span
                            ><span>{{ row.approvalStatus }}</span
                            ><small>{{ row.fillIdentityStatus }}</small>
                        </td>
                        <td>
                            {{ row.references.length }}개 후보 ·
                            {{
                                row.references.filter((r) => r.jointMatch)
                                    .length
                            }}개 수량·금액 일치<br /><small
                                >일치 ≠ 승인 · 합산 미확정</small
                            >
                        </td>
                        <td>
                            <Button
                                label="행 근거"
                                size="small"
                                :aria-label="`${row.symbol} ${text(row.quantity)} 행 근거`"
                                @click="selectedId = row.id" />
                        </td>
                    </tr>
                    <tr v-if="paddingBottom" aria-hidden="true">
                        <td
                            colspan="9"
                            :style="{
                                height: paddingBottom + 'px',
                                padding: 0,
                                border: 0,
                            }"></td>
                    </tr>
                </tbody>
            </table>
        </div>
        <section
            v-if="selected"
            class="selected-evidence"
            aria-label="선택 토스 관측 근거">
            <h3>
                {{ selected.symbol }} · {{ text(selected.quantity) }} · 독립
                관측 근거
            </h3>
            <p>
                {{ selected.normalizationStatus }} ·
                {{ selected.identityStatus }} ·
                {{ selected.fillIdentityStatus }}
            </p>
            <p>
                {{ selected.approvalStatus }}. 기존 시트 승인값과 별개이며 이
                화면은 승인하거나 저장하지 않습니다.
            </p>
            <h4>원문 위치</h4>
            <p>{{ selected.location }}</p>
            <Button
                v-if="
                    !selected.original &&
                    !selected.rawText &&
                    selected.hasOriginal
                "
                label="저장 원문 읽기"
                :disabled="busy"
                @click="emit('inspect', selected.observation)" />
            <details>
                <summary>보존 원문 · 받은 범위</summary>
                <pre>{{
                    selected.original
                        ? JSON.stringify(selected.original, null, 2)
                        : selected.rawText ||
                          '원문 미조회 또는 미연결 · 빈 원문으로 검증하지 않음'
                }}</pre>
            </details>
            <details open>
                <summary>정규화 관측값 · 원문 정밀도 유지</summary>
                <dl class="normalized-values">
                    <template
                        v-for="(value, field) in selected.values"
                        :key="field"
                        ><dt>
                            {{
                                labels[field] ||
                                {
                                    date: '원문 거래 기준일',
                                    purchasedUiAt:
                                        '구매 시각(화면 · 분 정밀도)',
                                    paymentDate: '지급일',
                                    exDate: '배당락일',
                                }[field] ||
                                field
                            }}
                        </dt>
                        <dd>{{ text(value) }}</dd></template
                    >
                </dl>
            </details>
            <h4>시트 보조 후보 · 원문값과 차이</h4>
            <p>
                같은 계좌·유형·날짜·종목으로 찾은 검토 후보입니다.
                주문·구매·정산 날짜 역할이 다르면 후보가 누락될 수 있으며,
                일치가 직접 ID 연결을 증명하지 않습니다.
            </p>
            <ul>
                <li
                    v-for="candidate in selected.references"
                    :key="candidate.id">
                    시트 수량 {{ text(candidate.quantity) }} / 금액 ${{
                        text(candidate.amountUsd)
                    }}
                    · 차이 수량 {{ text(candidate.quantityDifference) }} / 금액
                    ${{ text(candidate.amountDifference) }} ·
                    {{
                        candidate.jointMatch
                            ? '수량·금액 일치 후보 · 미승인'
                            : '불일치 또는 미확보'
                    }}
                </li>
            </ul>
            <Button
                label="근거 닫기"
                severity="secondary"
                @click="selectedId = null" />
        </section>
        <section class="checkpoint-review" aria-label="후속 대조 보고서">
            <h3>정밀도·기록 범위·주문 연결 검토</h3>
            <p>
                기존 관리자 인증으로 비공개 R2 체크포인트와 원문 증거의
                해시·버전·계좌를 서버에서 검증해 읽습니다. 조회는
                원문·장부·승인값을 바꾸지 않습니다.
            </p>
            <div class="controls">
                <label
                    >후속 보고서 계좌
                    <select
                        v-model="reportAccount"
                        aria-label="후속 보고서 계좌">
                        <option value="wife">아내 보고서</option>
                        <option value="husband">남편 보고서</option>
                    </select></label
                >
                <Button
                    label="후속 보고서 새로고침"
                    severity="secondary"
                    :disabled="reportLoading || !user"
                    :loading="reportLoading"
                    @click="loadReport(true)" />
            </div>
            <p v-if="!user">관리자 로그인 후 조회할 수 있습니다.</p>
            <p v-else-if="reportLoading" role="status">
                선택 계좌의 후속 보고서와 보존 원문을 검증하고 있습니다.
            </p>
            <p v-else-if="reportError" role="alert">{{ reportError }}</p>
            <p v-else-if="!reportHash">
                후속 보고서 미연결 · 이슈 없음이나 검증 완료를 뜻하지 않습니다.
            </p>
            <template v-else>
                <p>
                    보고서 계좌:
                    {{ checkpoint.accountId === 'wife' ? '아내' : '남편' }} ·
                    버전 {{ checkpoint.schemaVersion }} · 검토 기준
                    {{ checkpoint.snapshotAt }}
                </p>
                <p class="hash">
                    서버 검증 완료 · 체크포인트 SHA-256: {{ reportHash }} ·
                    보고서 SHA-256: {{ checkpoint.integrity.reportSha256 }} ·
                    원문 증거 SHA-256: {{ checkpoint.integrity.evidenceSha256 }}
                </p>
                <p>
                    원문 파일 {{ checkpoint.integrity.evidenceFileCount }}개
                    검증 · 목록↔상세 연결 확인은 시트 매핑 승인이나 개별 체결
                    검증이 아닙니다. 위 독립 관측에는 보고서의 주문 발췌가
                    포함되며 같은 경제적 사건을 합산하지 않습니다.
                </p>
                <article
                    v-for="item in review"
                    :key="item.id"
                    class="review-finding">
                    <h4>{{ item.id }} · {{ item.date }} {{ item.symbol }}</h4>
                    <p>
                        <strong>{{
                            {
                                reference_amount_not_explained:
                                    '금액 불일치 · 기록 범위 미확정',
                                possible_display_precision_difference:
                                    '정밀도·반올림 가능성 · 미확정',
                                different_candidate_or_aggregation_scope:
                                    '독립 주문의 수량·금액 혼합',
                            }[item.category] || '추가 검토'
                        }}</strong>
                    </p>
                    <p>{{ item.fact }}</p>
                    <p>
                        <strong>{{ item.uiLink }}</strong> · 시트 매핑
                        {{ item.approval }} · {{ item.fillIdentity }}
                    </p>
                    <ul>
                        <li
                            v-for="order in item.orders"
                            :key="`${order.account}:${order.orderNo}`">
                            {{ order.account }} · 주문 {{ order.orderNo }} ·
                            {{ order.quantity }}주 / ${{ order.amount }} ·
                            {{
                                order.verified
                                    ? '보고서상 목록↔상세 연결 확인'
                                    : '연결 미확인'
                            }}<span v-if="order.opaqueIdChanged">
                                · 과거 orderId 문자열과 다름 · 영속성
                                미검증</span
                            ><small>{{ order.sourceFiles.join(' · ') }}</small>
                        </li>
                    </ul>
                    <p>남은 근거: {{ item.missing }}</p>
                    <p>{{ item.nextAction }}</p>
                    <p>출처: {{ item.source }}</p>
                    <small
                        >보고서 기록 표시 · 원문·정규화값·승인값 변경
                        없음</small
                    >
                </article>
            </template>
        </section>
    </section>
</template>

<style scoped>
    .toss-trial {
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        margin-block: 1.5rem;
        padding: 1rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: var(--p-border-radius-md);
    }
    .controls {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        align-items: end;
    }
    label {
        display: grid;
        gap: 0.3rem;
    }
    input,
    select {
        padding: 0.5rem;
        color: var(--p-text-color);
        background: var(--p-content-background);
        border: 1px solid var(--p-content-border-color);
        border-radius: 4px;
    }
    .broker-table-region {
        overflow-x: auto;
    }
    .broker-table {
        border-collapse: collapse;
        width: 100%;
    }
    th,
    td {
        padding: 0.6rem;
        border-bottom: 1px solid var(--p-content-border-color);
        text-align: left;
        vertical-align: top;
        min-width: 6rem;
    }
    th button {
        color: inherit;
        background: none;
        border: 0;
        font: inherit;
        cursor: pointer;
        text-align: left;
    }
    small,
    td span {
        display: block;
    }
    .scope-note,
    small {
        color: var(--p-text-muted-color);
    }
    .selected-evidence,
    .checkpoint-review {
        margin-top: 1rem;
        padding: 1rem;
        background: var(--p-content-hover-background);
    }
    .normalized-values {
        display: grid;
        grid-template-columns: minmax(8rem, 1fr) 2fr;
        gap: 0.4rem;
    }
    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
    pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-width: 100%;
    }
    .hash,
    .review-finding p {
        overflow-wrap: anywhere;
    }
    .review-finding {
        border-top: 1px solid var(--p-content-border-color);
        padding-block: 0.7rem;
    }
</style>
