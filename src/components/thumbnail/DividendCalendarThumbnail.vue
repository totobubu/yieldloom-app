<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ data: any }>();
const today = new Date().toISOString().slice(0, 10);
const shortDate = (value?: string | null) => value ? value.replace(/-/g, '.') : '공시 미확인';
const frequencyNames: Record<string, string> = { weekly: '주배당', monthly: '월배당', quarterly: '분기배당', semiannual: '반기배당', annual: '연배당' };
const frequencyLabel = computed(() => frequencyNames[String(props.data?.frequency ?? '')] ?? '배당 일정');
const months = computed(() => {
    const start = new Date();
    const count = props.data?.frequency === 'weekly' ? 2 : 12;
    const firstMonth = props.data?.frequency === 'weekly' ? start.getMonth() : 0;
    return Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), firstMonth + index, 1));
});
const markerFor = (date: string) => (props.data?.markers ?? []).filter((marker: any) => marker.date === date);
const days = (month: Date) => Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index + 1).toISOString().slice(0, 10);
    return { date, day: index + 1, markers: markerFor(date) };
});
const monthName = (month: Date) => `${month.getMonth() + 1}월`;
</script>

<template>
    <section class="schedule-artboard" data-thumbnail-kind="calendar">
        <header><div><p>DIVIDEND SCHEDULE</p><h1>{{ data.symbol }}</h1></div><span class="frequency">{{ frequencyLabel }}</span></header>
        <section v-if="data.current" class="timeline"><div><small>배당락일</small><b>{{ shortDate(data.current.exDate) }}</b></div><i /><div><small>기준일</small><b>{{ shortDate(data.current.recordDate) }}</b></div><i /><div><small>지급일</small><b>{{ shortDate(data.current.payableDate) }}</b></div><i /><div class="deposit"><small>한국 계좌 예상</small><b>{{ data.depositRange ? `${shortDate(data.depositRange.start)}~${data.depositRange.end.slice(8)}` : '지급일 확인 후' }}</b></div></section>
        <p v-else class="unavailable">공식 배당 일정이 아직 없습니다.</p>
        <section class="calendar" :class="{ weekly: data.frequency === 'weekly' }"><article v-for="month in months" :key="month.toISOString()"><h2>{{ monthName(month) }}</h2><div class="week"><span v-for="name in ['일','월','화','수','목','금','토']" :key="name">{{ name }}</span></div><div class="days" :style="{ '--offset': new Date(month.getFullYear(), month.getMonth(), 1).getDay() }"><span v-for="item in days(month)" :key="item.date" :class="{ past: item.date < today, today: item.date === today, marked: item.markers.length }"><em v-for="marker in item.markers" :key="marker.kind" :class="[marker.kind, marker.status]" />{{ item.day }}</span></div></article></section>
        <aside><span><i class="ex" />배당락</span><span><i class="record" />기준일</span><span><i class="payable" />지급일</span><span><i class="deposit" />한국 입금 예상</span><span><i class="forecast" />추정</span></aside>
        <footer>공시 전 일정은 최근 주기 기반 추정 · 증권사·환전 처리에 따라 실제 입금일은 달라질 수 있습니다.</footer>
    </section>
</template>

<style scoped>
.schedule-artboard{box-sizing:border-box;width:720px;height:720px;padding:44px;background:linear-gradient(145deg,#0d1728,#123864);color:#f8fafc;font-family:Arial,sans-serif;display:flex;flex-direction:column}.schedule-artboard header{display:flex;justify-content:space-between;align-items:start}.schedule-artboard header p{margin:0;color:#8cbcff;font-size:15px;font-weight:800;letter-spacing:.14em}.schedule-artboard h1{margin:9px 0 0;font-size:70px;line-height:1}.frequency{padding:8px 12px;border:1px solid #7dace4;border-radius:999px;font-size:15px;font-weight:700}.timeline{display:grid;grid-template-columns:1fr 14px 1fr 14px 1fr 14px 1.25fr;align-items:center;gap:6px;margin:28px 0 20px;padding:18px 14px;border-radius:14px;background:#ffffff12}.timeline small{display:block;color:#c8d7e9;font-size:12px}.timeline b{display:block;margin-top:7px;font-size:14px;white-space:nowrap}.timeline i{height:2px;background:#6a93c2}.timeline .deposit b{color:#ffd47a}.unavailable{margin:25px 0;font-size:22px;text-align:center}.calendar{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;flex:1}.calendar.weekly{grid-template-columns:repeat(2,1fr);align-content:start}.calendar article{padding:8px;border-radius:10px;background:#ffffff0c}.calendar h2{margin:0 0 7px;font-size:14px}.week,.days{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}.week span{font-size:9px;color:#aabdd2}.days{grid-template-rows:repeat(6,1fr)}.days span{position:relative;display:grid;place-items:center;min-height:20px;font-size:10px}.days span:first-child{grid-column-start:calc(var(--offset) + 1)}.days .past{color:#718197}.days .today{outline:1px solid #b6d7ff;border-radius:50%}.days em{position:absolute;bottom:1px;width:4px;height:4px;border-radius:50%;background:#59a0ff}.days em.record{background:#b180ff}.days em.payable{background:#67dcaa}.days em.deposit{border:1px solid #ffd47a;background:transparent}.days em.forecast{border:1px dashed #aabdd2;background:transparent}.days em:nth-of-type(2){margin-left:7px}.days em:nth-of-type(3){margin-left:-7px}.days em.completed{opacity:.45}aside{display:flex;justify-content:center;gap:12px;margin:14px 0 8px;font-size:11px;color:#d5e1ee}aside span{display:flex;align-items:center;gap:4px}aside i{width:7px;height:7px;border-radius:50%;background:#59a0ff}aside .record{background:#b180ff}aside .payable{background:#67dcaa}aside .deposit{border:1px solid #ffd47a;background:transparent}aside .forecast{border:1px dashed #aabdd2;background:transparent}footer{font-size:11px;line-height:1.35;text-align:center;color:#b7c8d9}
</style>
