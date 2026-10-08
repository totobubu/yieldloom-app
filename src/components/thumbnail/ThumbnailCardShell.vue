<script setup lang="ts">
withDefaults(defineProps<{
	title: string;
	badge?: string;
	dateLabel?: string;
	dateValue?: string;
}>(), {
	badge: '',
	dateLabel: '기준일',
	dateValue: '',
});
</script>

<template>
	<section class="thumbnail-card-shell">
		<header class="thumbnail-card-header">
			<div class="thumbnail-card-title-group">
				<h1>{{ title }}</h1>
				<span v-if="badge" class="thumbnail-card-badge">{{ badge }}</span>
			</div>
			<div v-if="dateValue" class="thumbnail-card-date">
				<small>{{ dateLabel }}</small>
				<b>{{ dateValue }}</b>
			</div>
		</header>
		<main class="thumbnail-card-content">
			<slot />
		</main>
		<footer class="thumbnail-card-footer">
			<slot name="footer" />
		</footer>
	</section>
</template>

<style scoped>
.thumbnail-card-shell {
	box-sizing: border-box;
	width: 720px;
	height: 720px;
	display: flex;
	flex-direction: column;
	overflow: hidden
}

.thumbnail-card-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex: 0 0 auto
}

.thumbnail-card-title-group {
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0
}

.thumbnail-card-title-group h1 {
	margin: 0;
	color: #0f172a;

	font-size: 32px;
	font-weight: 900;
	letter-spacing: -.04em;
	line-height: 1
}

.thumbnail-card-badge {
	max-width: 270px;
	overflow: hidden;
	padding: 5px 10px;
	border: 1px solid #e2e8f0;
	border-radius: 6px;
	background: #f8fafc;
	color: #475569;

	font-size: 12px;
	font-weight: 700;
	line-height: 1;
	text-overflow: ellipsis;
	white-space: nowrap
}

.thumbnail-card-date {
	display: flex;
	flex: 0 0 auto;
	flex-direction: column;
	gap: 5px;
	align-items: flex-end;
	text-align: right
}

.thumbnail-card-date small {
	color: #94a3b8;

	font-size: 11px;
	font-weight: 700;
	line-height: 1
}

.thumbnail-card-date b {
	padding: 7px 11px;
	border: 1px solid #e2e8f0;
	border-radius: 8px;
	background: #ffffffcc;
	color: #0f172a;

	font-size: 16px;
	line-height: 1
}

.thumbnail-card-footer {
	flex: 0 0 auto
}

.thumbnail-card-content {
	min-height: 0;
	flex: 1;
	display: flex;
	flex-direction: column
}
</style>
