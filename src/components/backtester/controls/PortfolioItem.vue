<!-- src\components\backtester\controls\PortfolioItem.vue -->
<script setup>
    import { computed } from 'vue';
    import Card from 'primevue/card';
    import InputText from 'primevue/inputtext'; // [수정] AutoComplete -> InputText
    import Button from 'primevue/button';
    import Slider from 'primevue/slider';
    import InputNumber from 'primevue/inputnumber';
    import InputGroup from 'primevue/inputgroup';

    const props = defineProps({
        modelValue: Object,
        index: Number,
        // allSymbols와 filteredSymbols는 더 이상 필요 없습니다.
        // allSymbols: Array,
        // filteredSymbols: Array,
        maxValue: {
            type: Number,
            default: 100,
        },
    });

    const emit = defineEmits([
        'update:modelValue',
        'addItem',
        'removeItem',
        // 'search' 이벤트는 더 이상 필요 없습니다.
    ]);

    const item = computed({
        get: () => props.modelValue,
        set: (value) => emit('update:modelValue', value),
    });

    const isFirstItem = computed(() => props.index === 0);

    const handleRemove = () => emit('removeItem', props.index);
    const handleAdd = () => emit('addItem', props.index);
    // handleSearch 함수는 더 이상 필요 없습니다.
</script>

<template>
    <Card class="border-1 surface-border shadow-none h-full">
        <template #content>
            <div
                id="t-backtester-portfolio-item-empty"
                v-if="!isFirstItem && !item.symbol"
                class="flex align-items-center justify-content-center h-full">
                <Button icon="pi pi-plus" text @click="handleAdd" />
            </div>

            <div v-else id="t-backtester-portfolio-item">
                <InputGroup class="p-2">
                    <InputGroupAddon v-if="isFirstItem">
                        <Button
                            icon="pi pi-check"
                            severity="secondary"
                            disabled />
                    </InputGroupAddon>
                    <InputText
                        v-model="item.symbol"
                        :placeholder="`종목 ${index + 1}`"
                        class="p-inputtext-sm w-full"
                        @update:modelValue="
                            (val) => (item.symbol = val.toUpperCase())
                        " />

                    <InputGroupAddon v-if="!isFirstItem">
                        <Button
                            icon="pi pi-times"
                            severity="secondary"
                            @click="handleRemove" />
                    </InputGroupAddon>
                </InputGroup>
                <InputGroup class="text-center" v-if="isFirstItem">
                    <span class="w-full">기본종목 자동계산</span>
                </InputGroup>
                <InputGroup v-else>
                    <Slider
                        v-model="item.value"
                        class="flex-1"
                        :max="maxValue" />
                </InputGroup>

                <InputGroup class="">
                    <span
                        v-if="isFirstItem"
                        class="p-inputnumber p-component p-inputwrapper p-inputwrapper-filled p-inputtext-sm w-full">
                        <span
                            class="p-inputtext p-component p-filled p-inputnumber-input text-center">
                            {{ item.value || 0 }}%
                        </span>
                    </span>
                    <InputNumber
                        v-else
                        v-model="item.value"
                        class="p-inputtext-sm w-full"
                        suffix=" %"
                        min="1"
                        :max="maxValue"
                        :allowEmpty="false" />
                </InputGroup>

                <div
                    v-if="item.initialShares > 0"
                    class="text-xs mt-2 text-center">
                    초기 수량: {{ item.initialShares.toFixed(2) }}주
                </div>
            </div>
        </template>
    </Card>
</template>

<style scoped>
    :deep(.p-inputnumber-input) {
        text-align: right;
        width: 100%;
    }
    /* [추가] InputText 스타일 */
    :deep(.p-inputtext) {
        text-transform: uppercase;
    }
</style>
