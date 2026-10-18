<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import Message from 'primevue/message';
    import { calendarToday } from '@/services/portfolioCalendar.js';
    import {
        dividendCalendarFile,
        exportableDividendEvents,
    } from '@/services/dividendCalendarExport.js';

    const props = defineProps({
        rows: { type: Array, required: true },
        basis: { type: String, required: true },
        period: { type: String, required: true },
    });
    const consent = ref(false),
        reminderDays = ref(1),
        busy = ref(false),
        error = ref(''),
        status = ref('');
    const reminderOptions = [
        { label: '알림 없음', value: 0 },
        { label: '1일 전', value: 1 },
        { label: '3일 전', value: 3 },
        { label: '7일 전', value: 7 },
    ];
    const events = computed(() =>
        exportableDividendEvents(props.rows, {
            basis: props.basis,
            today: calendarToday(),
        })
    );
    let generation = 0;
    watch(
        () => [props.rows, props.basis, props.period],
        () => {
            generation++;
            consent.value = false;
            busy.value = false;
            error.value = status.value = '';
        },
        { flush: 'sync' }
    );
    onScopeDispose(() => generation++);
    async function download() {
        if (!consent.value || busy.value) return;
        const version = generation;
        busy.value = true;
        error.value = status.value = '';
        try {
            const result = await dividendCalendarFile(props.rows, {
                basis: props.basis,
                today: calendarToday(),
                reminderDays: reminderDays.value,
            });
            if (version !== generation) return;
            const url = URL.createObjectURL(
                new Blob([result.content], {
                    type: 'text/calendar;charset=utf-8',
                })
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `dividend-${props.basis}-${props.period}.ics`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.value = `${result.count}개 일정 파일 다운로드를 시작했습니다. 캘린더 앱에서 가져온 뒤 알림 설정을 확인하세요.`;
        } catch (reason) {
            if (version === generation) error.value = reason.message;
        } finally {
            if (version === generation) busy.value = false;
        }
    }
</script>

<template>
    <section
        class="calendar-export"
        aria-labelledby="calendar-export-title"
        :aria-busy="busy">
        <h3 id="calendar-export-title">캘린더 일정·알림 내보내기</h3>
        <p>
            선택 기간·계좌·통화 필터에서 오늘 이후 공시 일정
            {{ events.length }}개를 내보냅니다. 같은 종목·날짜는 하나로 합치며
            확인 필요·주기 추정·과거 일정은 제외합니다.
        </p>
        <label for="calendar-reminder">사전 알림</label>
        <Select
            v-model="reminderDays"
            input-id="calendar-reminder"
            aria-label="사전 알림"
            :options="reminderOptions"
            option-label="label"
            option-value="value"
            :disabled="busy" />
        <label class="consent"
            ><input v-model="consent" type="checkbox" :disabled="busy" /> 파일에
            보유 종목명과 배당 일정이 포함되며, 외부 캘린더로 가져올 수 있음을
            확인했습니다.</label
        >
        <Button
            label="배당 일정 ICS 다운로드"
            icon="pi pi-calendar-plus"
            :disabled="!consent || !events.length || busy"
            :loading="busy"
            @click="download" />
        <p>
            계좌명·수량·금액은 포함하지 않습니다. 파일을 구글·애플 등 캘린더
            앱에서 가져와야 합니다. 종일 일정이며 알림 시각·지원 여부는 캘린더
            앱 설정에 따릅니다. 사전 알림 시점이 이미 지난 일정은 알림이 오지
            않을 수 있습니다.
        </p>
        <p>
            앱의 자동 푸시나 일정 구독은 아닙니다. 공시가 변경되어도 가져온
            일정은 자동 갱신되지 않으므로 다시 확인하세요. 재가져오기 시 중복
            처리 방식도 캘린더 앱마다 다릅니다.
        </p>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <Message
            v-if="status"
            severity="success"
            :closable="false"
            role="status"
            >{{ status }}</Message
        >
    </section>
</template>

<style scoped>
    .calendar-export {
        margin-block: 1rem;
        padding: 1rem;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        overflow-wrap: anywhere;
    }
    label {
        display: block;
        margin-block: 0.75rem 0.4rem;
    }
    .consent {
        display: flex;
        align-items: start;
        gap: 0.5rem;
        margin-block: 1rem;
    }
</style>
