<script setup>
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    defineProps({
        item: { type: Object, required: true },
        columns: { type: Array, required: true },
        busy: Boolean,
    });
    const emit = defineEmits(['update-row']);
</script>
<template>
    <div class="generic-card-fields">
        <div
            v-for="column in columns"
            :key="column.field"
            class="generic-card-field"
            role="group"
            :aria-label="`${item.index + 1}행 ${column.label}`">
            <span>{{ column.label }}</span
            ><template v-if="column.field === 'amount'"
                ><Select
                    :model-value="item.row.currency"
                    :options="[
                        { label: 'USD', value: 'USD' },
                        { label: 'KRW', value: 'KRW' },
                    ]"
                    option-label="label"
                    option-value="value"
                    placeholder="통화 선택"
                    :aria-label="`${item.index + 1}행 currency`"
                    :disabled="busy"
                    @update:model-value="
                        emit('update-row', {
                            index: item.index,
                            field: 'currency',
                            value: $event,
                        })
                    " /><InputText
                    :model-value="item.row.amount"
                    :aria-label="`${item.index + 1}행 amount`"
                    :disabled="busy"
                    @update:model-value="
                        emit('update-row', {
                            index: item.index,
                            field: 'amount',
                            value: $event,
                        })
                    " /></template
            ><InputText
                v-else
                :model-value="item.row[column.field]"
                :aria-label="`${item.index + 1}행 ${column.field}`"
                :disabled="busy"
                @update:model-value="
                    emit('update-row', {
                        index: item.index,
                        field: column.field,
                        value: $event,
                    })
                " />
        </div>
    </div>
</template>
<style scoped>
    .generic-card-fields {
        display: grid;
        gap: 10px;
        margin-top: 10px;
    }
    .generic-card-field {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 4px;
        font-size: 11px;
        line-height: 18px;
    }
    .generic-card-fields :deep(.p-inputtext),
    .generic-card-fields :deep(.p-select) {
        width: 100%;
        min-width: 0;
        font-size: 12px;
    }
    @media (min-width: 641px) {
        .generic-card-fields {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
