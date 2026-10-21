<script setup>
    import {
        computed,
        onMounted,
        onScopeDispose,
        reactive,
        ref,
        watch,
    } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import Message from 'primevue/message';
    import { firebaseUser } from '@/services/firebaseClient.js';
    import { portfolioPreferences } from '@/services/familyPortfolio.js';
    import { calendarToday } from '@/services/portfolioCalendar.js';
    import {
        upcomingDividendAlerts,
        takeUndeliveredAlerts,
    } from '@/services/portfolioAlerts.js';
    const props = defineProps({
        rows: { type: Array, default: () => [] },
        basis: { type: String, default: 'payable' },
        showSettings: { type: Boolean, default: true },
        showUpcoming: { type: Boolean, default: true },
    });
    const prefs = reactive({ enabled: false, leadDays: 3, browser: false });
    const saved = ref(null),
        revision = ref(0),
        busy = ref(false),
        error = ref(''),
        status = ref('');
    let generation = 0;
    const today = ref(calendarToday());
    const refreshToday = () => {
        today.value = calendarToday();
    };
    onMounted(() => {
        window.addEventListener('focus', refreshToday);
        document.addEventListener('visibilitychange', refreshToday);
    });
    watch(() => props.rows, refreshToday);
    onScopeDispose(() => {
        generation++;
        window.removeEventListener('focus', refreshToday);
        document.removeEventListener('visibilitychange', refreshToday);
    });
    const upcoming = computed(() =>
        prefs.enabled && saved.value?.enabled
            ? upcomingDividendAlerts(props.rows, {
                  basis: props.basis,
                  today: today.value,
                  leadDays: saved.value.leadDays,
              })
            : []
    );
    const changed = computed(
        () =>
            saved.value && JSON.stringify(prefs) !== JSON.stringify(saved.value)
    );
    async function load(force = false) {
        const version = ++generation;
        busy.value = true;
        error.value = '';
        try {
            const result = await portfolioPreferences.get({ force });
            if (version !== generation) return;
            Object.assign(prefs, result.preferences);
            saved.value = { ...result.preferences };
            revision.value = result.revision;
            today.value = calendarToday();
        } catch (reason) {
            if (version === generation) error.value = reason.message;
        } finally {
            if (version === generation) busy.value = false;
        }
    }
    onMounted(() => load());
    async function save() {
        const version = generation;
        busy.value = true;
        error.value = status.value = '';
        try {
            const result = await portfolioPreferences.save(
                { ...prefs },
                revision.value
            );
            if (version !== generation) return;
            saved.value = { ...result.preferences };
            revision.value = result.revision;
            status.value = '알림 설정을 계정에 저장했습니다.';
        } catch (reason) {
            if (version === generation) error.value = reason.message;
        } finally {
            if (version === generation) busy.value = false;
        }
    }
    async function allowBrowser() {
        const version = generation;
        if (!('Notification' in window)) {
            error.value = '이 브라우저는 알림을 지원하지 않습니다.';
            return;
        }
        const permission = await Notification.requestPermission();
        if (version !== generation) return;
        if (permission !== 'granted')
            error.value =
                '브라우저 알림 권한이 허용되지 않았습니다. 앱 내 알림은 사용할 수 있습니다.';
        else
            status.value =
                '브라우저 알림 권한을 허용했습니다. 설정을 저장해 주세요.';
    }
    watch([upcoming, saved], () => {
        if (
            !saved.value?.enabled ||
            !saved.value.browser ||
            !firebaseUser.value ||
            !('Notification' in window) ||
            Notification.permission !== 'granted'
        )
            return;
        for (const event of takeUndeliveredAlerts(
            firebaseUser.value,
            upcoming.value,
            props.basis,
            today.value
        )) {
            try {
                new Notification('배당 공시 일정 알림', {
                    body: `${event.symbol} · ${event.date} ${props.basis === 'ex' ? '배당락일' : '지급일'} · 지급 자격은 별도 확인`,
                    tag: event.key,
                });
            } catch {
                error.value =
                    '브라우저 알림을 표시하지 못했습니다. 아래 앱 내 알림을 확인하세요.';
            }
        }
    });
</script>
<template>
    <section
        v-if="showSettings || (showUpcoming && saved?.enabled)"
        class="dividend-alerts"
        aria-label="자동 배당 알림"
        :aria-busy="busy">
        <template v-if="showSettings">
            <h3>자동 배당 알림</h3>
            <p>
                계정에 저장한 설정으로 앱을 열거나 공시 자료를 갱신할 때 가까운
                공시 일정을 자동 표시합니다. 선택한 계좌·통화 필터를 따르며 앱이
                닫힌 동안의 푸시·메일 전송은 제공하지 않습니다.
            </p>
            <fieldset :disabled="busy || !saved">
                <legend>내 알림 설정</legend>
                <label
                    ><input v-model="prefs.enabled" type="checkbox" /> 앱 내
                    자동 알림 사용</label
                >
                <label
                    >미리 알려줄 기간<Select
                        v-model="prefs.leadDays"
                        :options="[
                            { label: '1일', value: 1 },
                            { label: '3일', value: 3 },
                            { label: '7일', value: 7 },
                        ]"
                        option-label="label"
                        option-value="value"
                        aria-label="자동 알림 기간"
                /></label>
                <label
                    ><input v-model="prefs.browser" type="checkbox" /> 앱을 열어
                    둔 동안 브라우저 알림도 표시 (종목명 포함)</label
                >
                <div class="actions">
                    <Button
                        label="브라우저 알림 권한 허용"
                        outlined
                        @click="allowBrowser" /><Button
                        label="알림 설정 저장"
                        :disabled="!changed"
                        @click="save" />
                </div>
            </fieldset>
            <Button
                label="알림 설정 다시 조회"
                text
                :disabled="busy"
                @click="load(true)" />
            <Message v-if="error" severity="error" :closable="false">{{
                error
            }}</Message>
            <Message v-if="status" severity="success" :closable="false">{{
                status
            }}</Message>
        </template>
        <div
            v-if="showUpcoming && saved?.enabled"
            role="status"
            aria-label="다가오는 배당 알림">
            <p v-if="!upcoming.length">
                선택 범위에서 {{ saved.leadDays }}일 이내 공시 일정이 없습니다.
                수집되지 않은 일정은 포함되지 않습니다.
            </p>
            <ul v-else>
                <li v-for="event in upcoming" :key="event.key">
                    {{ event.date }} · {{ event.symbol }} ·
                    {{ basis === 'ex' ? '배당락일' : '지급일' }} 공시 확인
                </li>
            </ul>
        </div>
    </section>
</template>
<style scoped>
    .dividend-alerts {
        padding: 1rem;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        overflow-wrap: anywhere;
    }
    fieldset {
        min-width: 0;
        border: 0;
        padding: 0;
    }
    label,
    .actions {
        display: flex;
        align-items: start;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-block: 0.75rem;
    }
</style>
