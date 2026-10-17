<script setup>
    import InputNumber from 'primevue/inputnumber';
    import Select from 'primevue/select';
    import ToggleSwitch from 'primevue/toggleswitch';
    const props = defineProps({
        modelValue: { type: Object, required: true },
        name: { type: String, required: true },
        taxOnly: Boolean,
        currency: { type: String, default: 'USD' },
    });
    const emit = defineEmits(['update:modelValue']);
    const update = (key, value) =>
        emit('update:modelValue', { ...props.modelValue, [key]: value });
    const fields = [
        { key: 'initial', label: '최초 투자액', min: 0, max: 1e9 },
        { key: 'contribution', label: '월 추가 납입', min: 0, max: 1e7 },
        { key: 'price', label: '시작 주가', min: 0.000001, max: 1e7 },
        { key: 'annualDividend', label: '연간 주당 배당금', min: 0, max: 1e7 },
        { key: 'taxRate', label: '원천징수 가정 (%)', min: 0, max: 100 },
        { key: 'fee', label: '매수 건당 수수료', min: 0, max: 10000 },
    ];
    const frequencies = [
        { label: '매주', value: 'weekly' },
        { label: '매월', value: 'monthly' },
        { label: '분기', value: 'quarterly' },
        { label: '반기', value: 'semiannual' },
        { label: '매년', value: 'annual' },
    ];
</script>
<template>
    <section class="scenario-form" :aria-label="`시나리오 ${name} 입력`">
        <header>
            <span class="scenario-badge">{{ name }}</span>
            <h2>시나리오 {{ name }}</h2>
        </header>
        <p v-if="taxOnly" class="scenario-note">
            A와 같은 투자·재투자 가정에서 B의 원천징수율만 바꿉니다.
        </p>
        <div class="scenario-fields">
            <div v-for="field in fields" :key="field.key" class="studio-field">
                <label :for="`sim-${name}-${field.key}`"
                    >{{ name }} {{ field.label }}
                    <small v-if="field.key !== 'taxRate'">{{
                        currency
                    }}</small></label
                ><InputNumber
                    :model-value="modelValue[field.key]"
                    :input-id="`sim-${name}-${field.key}`"
                    :min="field.min"
                    :max="field.max"
                    :max-fraction-digits="6"
                    :min-fraction-digits="0"
                    :disabled="taxOnly && field.key !== 'taxRate'"
                    fluid
                    @update:model-value="update(field.key, $event)" />
            </div>
            <div class="studio-field">
                <label
                    :id="`sim-${name}-frequency-label`"
                    :for="`sim-${name}-frequency`"
                    >{{ name }} 배당 지급 주기</label
                ><Select
                    :model-value="modelValue.frequency"
                    :input-id="`sim-${name}-frequency`"
                    :aria-labelledby="`sim-${name}-frequency-label`"
                    :options="frequencies"
                    option-label="label"
                    option-value="value"
                    :disabled="taxOnly"
                    @update:model-value="update('frequency', $event)" />
            </div>
        </div>
        <div class="scenario-switches">
            <label :for="`sim-${name}-reinvest`"
                ><ToggleSwitch
                    :model-value="modelValue.reinvest"
                    :input-id="`sim-${name}-reinvest`"
                    :disabled="taxOnly"
                    @update:model-value="update('reinvest', $event)" />{{
                    name
                }}
                세후 배당 재투자</label
            ><label :for="`sim-${name}-fractional`"
                ><ToggleSwitch
                    :model-value="modelValue.fractional"
                    :input-id="`sim-${name}-fractional`"
                    :disabled="taxOnly"
                    @update:model-value="update('fractional', $event)" />{{
                    name
                }}
                소수주 매수 허용</label
            >
        </div>
    </section>
</template>
<style scoped>
    .scenario-form {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        padding: 24px;
        background: var(--app-surface);
        min-width: 0;
    }
    .scenario-form header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
    }
    .scenario-form h2 {
        margin: 0;
        font-size: 21px;
    }
    .scenario-badge {
        padding: 8px 13px;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        border-radius: 9px;
        font-weight: 800;
    }
    .scenario-fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 20px;
    }
    .scenario-fields small {
        font-size: 11px;
        color: var(--app-muted);
    }
    .scenario-switches {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        margin-top: 22px;
    }
    .scenario-switches label {
        display: flex;
        gap: 10px;
        align-items: center;
        font-size: 13px;
    }
    .scenario-note {
        font-size: 13px;
        color: var(--app-muted);
        line-height: 1.7;
        margin: 0 0 18px;
    }
    @media (max-width: 600px) {
        .scenario-form {
            padding: 20px;
        }
        .scenario-fields {
            grid-template-columns: 1fr;
        }
        .scenario-switches {
            display: grid;
        }
    }
</style>
