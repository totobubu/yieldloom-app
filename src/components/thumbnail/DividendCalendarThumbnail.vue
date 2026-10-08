<script setup lang="ts">
import { computed } from 'vue';
import ThumbnailCardShell from './ThumbnailCardShell.vue';

const props = defineProps<{ data: any }>();
const now = new Date();
const today = now.toISOString().slice(0, 10);
const weekday = ['일', '월', '화', '수', '목', '금', '토'];
const shortDate = (value?: string | null) => value ? value.slice(5).replace('-', '.') : '미정';
const dateWithDay = (value?: string | null) => {
	if (!value) return '공시 미확인';
	const local = new Date(`${value}T12:00:00`);
	return `${shortDate(value)} (${weekday[local.getDay()]})`;
};
const frequencyNames: Record<string, string> = { weekly: '주배당', monthly: '월배당', quarterly: '분기배당', semiannual: '반기배당', annual: '연배당' };
const frequencyLabel = computed(() => frequencyNames[String(props.data?.frequency ?? '')] ?? '배당 일정');
const isWeekly = computed(() => props.data?.frequency === 'weekly');
const usd = (value?: string | number | null) => value != null && Number.isFinite(Number(value)) ? `$${Number(value).toFixed(4).replace(/\.?(0+)$/, '')}` : '—';
const addDays = (value: string, days: number) => new Date(new Date(`${value}T12:00:00`).getTime() + days * 86400000).toISOString().slice(0, 10);
const active = computed(() => props.data?.current ?? null);
const completed = computed(() => (props.data?.history ?? [])
	.filter((event: any) => event.exDate < today && event.id !== active.value?.id)
	.slice(0, 2)
	.reverse());
const cycle = computed(() => {
	const forecast = props.data?.forecastExDate;
	const interval = props.data?.intervalDays;
	return [
		...completed.value.map((event: any, index: number) => ({ key: `past-${event.exDate}`, label: `W-${completed.value.length - index}`, badge: '완료', event, tone: index ? 'settled' : 'past', detail: event.payableDate && event.payableDate < today ? '지급 완료' : '배당락 완료' })),
		...(active.value ? [{ key: 'active', label: active.value.exDate >= today ? '이번 배당' : '최근 배당', badge: active.value.exDate >= today ? '진행' : '완료', event: active.value, tone: 'active', detail: active.value.exDate >= today ? '공식 공시 일정' : '가장 최근 확정 회차' }] : []),
		...(forecast ? [{ key: 'forecast', label: 'W+1', badge: '추정', event: { exDate: forecast }, tone: 'forecast', detail: '최근 주기 기반' }] : []),
		...(forecast && interval ? [{ key: 'forecast-2', label: 'W+2', badge: '추정', event: { exDate: addDays(forecast, interval) }, tone: 'forecast muted', detail: '주기 추정' }] : []),
	].slice(-5);
});
const annualSlots = computed(() => {
	const quarterly = props.data?.frequency === 'quarterly';
	const count = quarterly ? 4 : 12;
	return Array.from({ length: count }, (_, index) => {
		const month = quarterly ? index * 3 : index;
		const event = (props.data?.history ?? []).find((row: any) => {
			if (!row.exDate?.startsWith(String(now.getFullYear()))) return false;
			const rowMonth = Number(row.exDate.slice(5, 7)) - 1;
			return quarterly ? Math.floor(rowMonth / 3) === index : rowMonth === month;
		});
		const current = Boolean(event && event.id === props.data?.current?.id);
		return { label: quarterly ? `${index + 1}분기` : `${index + 1}월`, event, current, done: Boolean(event && event.exDate < today), future: !event && month > now.getMonth() };
	});
});
const completedSlots = computed(() => annualSlots.value.filter((slot) => slot.done).length);
</script>

<template>
	<ThumbnailCardShell class="schedule-artboard" :title="data.symbol" :badge="frequencyLabel" date-label="기준일자"
		:date-value="today.replace(/-/g, '.')" data-thumbnail-kind="calendar">
		<section v-if="data.current" class="lifecycle">
			<div class="section-heading">
				<h2><i />차기 배당 일정 라이프사이클</h2><span>공식 공시 확정 일정</span>
			</div>
			<div class="steps">
				<article class="ex">
					<div><small>STEP 01</small><em>EX-DATE</em>
						<h3>배당락일</h3>
					</div><b>{{ dateWithDay(data.current.exDate) }}</b>
					<p>매수 마감 완료</p>
				</article>
				<article class="record">
					<div><small>STEP 02</small><em>RECORD</em>
						<h3>기준일</h3>
					</div><b>{{ dateWithDay(data.current.recordDate) }}</b>
					<p>주주 명부 확정</p>
				</article>
				<article class="payable">
					<div><small>STEP 03</small><em>PAYABLE</em>
						<h3>지급일</h3>
					</div><b>{{ dateWithDay(data.current.payableDate) }}</b>
					<p>미국 현지 지급</p>
				</article>
				<article class="arrival">
					<div><small>STEP 04</small><em>ARRIVAL</em>
						<h3>한국 입금 예상</h3>
					</div><b>{{ data.depositRange ?
						`${shortDate(data.depositRange.start)}~${data.depositRange.end.slice(8)}` : '지급일 확인 후' }}</b>
					<p>+1~2 영업일</p>
				</article>
			</div>
		</section>
		<p v-else class="unavailable">공식 배당 일정이 아직 없습니다.</p>
		<section v-if="isWeekly" class="weekly-cycle">
			<div class="section-heading">
				<h2>주간 배당 5주 사이클 캘린더</h2>
				<aside><span class="past-dot" />지난 배당 <span class="ex-dot" />배당락 <span class="pay-dot" />지급 <span
						class="arrival-dot" />국내입금</aside>
			</div>
			<div class="cycle">
				<article v-for="item in cycle" :key="item.key" :class="item.tone">
					<div><span class="cycle-label">{{ item.label }}</span><em>{{ item.badge }}</em><b>{{
						dateWithDay(item.event.exDate) }}</b>
						<p>{{ item.detail }}</p>
					</div>
					<footer><strong v-if="item.event.amount">{{ usd(item.event.amount) }}</strong><span
							v-else-if="item.event.payableDate">{{ shortDate(item.event.payableDate) }} 지급</span><span
							v-else>공시 대기</span><i /></footer>
				</article>
			</div>
		</section>
		<section v-else class="annual-roadmap">
			<div class="section-heading">
				<h2>{{ data.frequency === 'quarterly' ? '연간 분기배당 로드맵' : '연간 월배당 풀사이클 로드맵' }}</h2>
				<aside>연간 진행률 <b>{{ Math.round((completedSlots / annualSlots.length) * 100) }}%</b></aside>
			</div>
			<div class="track" :class="{ quarterly: data.frequency === 'quarterly' }"><i
					:style="{ width: `${(completedSlots / annualSlots.length) * 100}%` }" />
				<div><span v-for="slot in annualSlots" :key="slot.label"
						:class="{ done: slot.done, current: slot.current, future: slot.future }"><em>{{ slot.done ? '✓'
							: slot.current ? '★' : '·' }}</em>{{ slot.label }}</span></div>
			</div>
			<div class="slot-grid" :class="{ quarterly: data.frequency === 'quarterly' }">
				<article v-for="slot in annualSlots" :key="slot.label"
					:class="{ done: slot.done, current: slot.current, future: slot.future }">
					<header><b>{{ slot.label }}</b><em>{{ slot.current ? '이번 회차' : slot.done ? '지급완료' : slot.future ?
						'주기 추정' : '대기' }}</em></header><template v-if="slot.event">
						<p><span>배당락</span><b>{{ shortDate(slot.event.exDate) }}</b></p>
						<p><span>현지지급</span><b>{{ shortDate(slot.event.payableDate) }}</b></p>
						<p><span>국내입금</span><b>지급 후 +1~2영업일</b></p>
						<footer><small>DPS</small><strong>{{ usd(slot.event.amount) }}</strong></footer>
					</template>
					<p v-else class="empty">{{ slot.future ? '공시 전 일정' : '기록 없음' }}</p>
				</article>
			</div>
		</section>
		<template #footer>ⓘ 공시 전 일정은 최근 주기 기반 추정 · 증권사/환전 처리에 따라 실제 입금일은 달라질 수 있음</template>
	</ThumbnailCardShell>
</template>

<style scoped>
.as-of {
	min-width: 135px;
	padding: 11px 15px;
	border: 1px solid #e2e8f0;
	border-radius: 16px;
	background: #ffffffdf;
	box-shadow: 0 2px 5px #0f172a12;
	text-align: right
}

.as-of small {
	display: block;
	color: #64748b;
	font-size: 11px;
	font-weight: 800
}

.as-of b {
	font-size: 17px
}

.lifecycle,
.weekly-cycle,
.annual-roadmap {
	padding: 16px;
	border: 1px solid #e2e8f0;
	border-radius: 20px;
	background: #ffffffdf;
	box-shadow: 0 2px 5px #0f172a0d
}

.section-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	margin-bottom: 12px
}

.section-heading h2 {
	margin: 0;
	font-size: 18px
}

.section-heading h2 i {
	display: inline-block;
	width: 9px;
	height: 9px;
	margin-right: 9px;
	border-radius: 50%;
	background: #60a5fa
}

.section-heading>span {
	padding: 7px 10px;
	border: 1px solid #e2e8f0;
	border-radius: 8px;
	background: #f1f5f9;
	color: #475569;
	font-size: 11px;
	font-weight: 700
}

.steps {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 10px
}

.steps article {
	min-height: 128px;
	padding: 12px;
	border: 1px solid;
	border-radius: 15px;
	display: flex;
	flex-direction: column
}

.steps article>div {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 7px
}

.steps small {
	padding: 4px 6px;
	border: 1px solid #dbeafe;
	border-radius: 4px;
	background: #fff;
	font-weight: 700;
	font-size: 10px
}

.steps em {
	margin-left: auto;
	font-size: 10px;
	font-style: normal;
	font-weight: 800
}

.steps h3 {
	width: 100%;
	margin: 7px 0 0;
	font-size: 16px
}

.steps b {
	margin-top: auto;
	padding-top: 12px;
	border-top: 1px solid;
	font-weight: 800;
	font-size: 17px;
	letter-spacing: -.08em
}

.steps p {
	margin: 8px 0 0;
	padding: 5px;
	border-radius: 4px;
	text-align: center;
	font-size: 11px;
	font-weight: 700
}

.ex {
	border-color: #bfdbfe !important;
	background: #eff6ff
}

.ex em,
.ex b {
	color: #1d4ed8
}

.ex b {
	border-color: #dbeafe
}

.ex p {
	background: #dbeafe;
	color: #2563eb
}

.record {
	border-color: #ddd6fe !important;
	background: #f5f3ff
}

.record em,
.record b {
	color: #7c3aed
}

.record b {
	border-color: #ede9fe
}

.record p {
	background: #ede9fe;
	color: #7c3aed
}

.payable {
	border-color: #a7f3d0 !important;
	background: #ecfdf5
}

.payable em,
.payable b {
	color: #047857
}

.payable b {
	border-color: #d1fae5
}

.payable p {
	background: #d1fae5;
	color: #047857
}

.arrival {
	border-style: dashed !important;
	border-color: #fbbf24 !important;
	background: #fffbeb
}

.arrival em,
.arrival b {
	color: #b45309
}

.arrival b {
	border-color: #fde68a
}

.arrival p {
	background: #fef3c7;
	color: #92400e
}

.weekly-cycle {
	flex: 1;
	display: flex;
	flex-direction: column;
	justify-content: center
}

.section-heading aside {
	display: flex;
	align-items: center;
	gap: 6px;
	color: #64748b;
	font-size: 10px;
	font-weight: 700
}

.section-heading aside span,
.cycle footer i {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	display: inline-block
}

.past-dot {
	background: #94a3b8
}

.ex-dot {
	background: #2563eb
}

.pay-dot {
	background: #059669
}

.arrival-dot {
	border: 1px dashed #d97706;
	background: #fbbf24
}

.cycle {
	display: grid;
	grid-template-columns: repeat(5, 1fr);
	gap: 10px
}

.cycle article {
	min-height: 145px;
	padding: 12px;
	border: 1px solid #e2e8f0;
	border-radius: 14px;
	background: #f8fafc;
	display: flex;
	flex-direction: column;
	justify-content: space-between
}

.cycle article.past {
	opacity: .66;
	background: #f1f5f9
}

.cycle article.settled {
	opacity: .85
}

.cycle article.active {
	border: 2px solid #2563eb;
	background: #eff6ff;
	box-shadow: 0 6px 14px #2563eb22
}

.cycle article.forecast {
	border-style: dashed;
	border-color: #60a5fa;
	background: #fff
}

.cycle article.muted {
	border-color: #cbd5e1
}

.cycle-label {
	font-weight: 800;
	font-size: 11px;
	color: #64748b
}

.cycle em {
	float: right;
	padding: 3px 6px;
	border-radius: 4px;
	background: #e2e8f0;
	color: #475569;
	font-size: 10px;
	font-style: normal;
	font-weight: 800
}

.active .cycle-label,
.active b,
.active p {
	color: #1d4ed8
}

.active em {
	background: #dbeafe;
	color: #1d4ed8
}

.forecast em {
	background: #eff6ff;
	color: #2563eb
}

.cycle article b {
	display: block;
	margin-top: 16px;
	font-weight: 800;
	font-size: 18px;
	letter-spacing: -.08em
}

.cycle article p {
	margin: 5px 0;
	font-size: 11px;
	color: #64748b;
	font-weight: 700
}

.cycle footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding-top: 8px;
	border-top: 1px solid #e2e8f0;
	color: #64748b;
	font-size: 10px
}

.cycle footer strong {
	color: #047857;
}

.cycle footer i {
	background: #94a3b8
}

.active footer i {
	background: #2563eb
}

.forecast footer i {
	border: 1px solid #2563eb;
	background: transparent
}

.annual-roadmap {
	flex: 1
}

.annual-roadmap .section-heading aside {
	color: #64748b;
	font-size: 11px;
	font-weight: 700
}

.annual-roadmap .section-heading aside b {
	color: #2563eb;
}

.track {
	position: relative;
	margin-bottom: 13px;
	padding: 12px 9px;
	border: 1px solid #e2e8f0;
	border-radius: 12px;
	background: #f8fafc
}

.track>i {
	position: absolute;
	z-index: 1;
	top: 12px;
	left: 9px;
	height: 7px;
	border-radius: 7px;
	background: linear-gradient(90deg, #10b981, #2563eb)
}

.track:before {
	position: absolute;
	top: 12px;
	right: 9px;
	left: 9px;
	height: 7px;
	border-radius: 7px;
	background: #e2e8f0;
	content: ''
}

.track>div {
	position: relative;
	z-index: 2;
	display: grid;
	grid-template-columns: repeat(12, 1fr);
	gap: 2px;
	margin-top: 10px;
	text-align: center
}

.track span {
	color: #94a3b8;
	font-size: 9px;
	font-weight: 700
}

.track em {
	display: block;
	width: 13px;
	height: 13px;
	margin: -16px auto 4px;
	border: 2px solid #fff;
	border-radius: 50%;
	background: #cbd5e1;
	color: #fff;
	font-size: 8px;
	font-style: normal;
	line-height: 13px
}

.track .done {
	color: #047857
}

.track .done em {
	background: #10b981
}

.track .current {
	color: #1d4ed8
}

.track .current em {
	width: 15px;
	height: 15px;
	margin-top: -17px;
	line-height: 15px;
	background: #2563eb;
	box-shadow: 0 0 0 4px #dbeafe
}

.slot-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 7px
}

.slot-grid article {
	min-height: 104px;
	padding: 8px;
	border: 1px solid #e2e8f0;
	border-radius: 10px;
	background: #f8fafc;
	display: flex;
	flex-direction: column
}

.slot-grid article.current {
	border: 2px solid #2563eb;
	background: #eff6ff
}

.slot-grid article.future {
	border-style: dashed;
	background: #fff
}

.slot-grid header {
	display: flex;
	justify-content: space-between;
	gap: 3px
}

.slot-grid header>b {
	font-weight: 800;
	font-size: 10px
}

.slot-grid header em {
	padding: 2px 4px;
	border-radius: 3px;
	background: #e2e8f0;
	color: #64748b;
	font-size: 8px;
	font-style: normal;
	font-weight: 800
}

.slot-grid .current header em {
	background: #2563eb;
	color: #fff
}

.slot-grid .done header em {
	background: #d1fae5;
	color: #047857
}

.slot-grid p {
	display: flex;
	justify-content: space-between;
	margin: 4px 0 0;
	color: #64748b;
	font-size: 8px
}

.slot-grid p b {
	color: #334155
}

.slot-grid footer {
	display: flex;
	justify-content: space-between;
	margin-top: auto;
	padding-top: 5px;
	border-top: 1px solid #e2e8f0
}

.slot-grid footer small {
	color: #94a3b8;
	font-size: 8px
}

.slot-grid footer strong {
	color: #047857;
	font-weight: 800;
	font-size: 10px
}

.slot-grid .empty {
	margin: auto 0;
	color: #94a3b8;
	font-size: 9px
}

.disclaimer {
	margin-top: auto;
	padding-top: 10px;
	border-top: 1px solid #e2e8f0;
	color: #64748b;
	font-size: 11px
}
</style>
