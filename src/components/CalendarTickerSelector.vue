<!-- stock\src\components\CalendarTickerSelector.vue -->
<template>
    <div class="p-calendar-search">
        <ScrollPanel style="height: 100%">
            <Accordion :activeIndex="[0]" id="t-calendar-toggle">
                <AccordionPanel
                    v-for="group in filteredGroupedTickers"
                    :key="group.company"
                    :value="group.items">
                    <AccordionHeader>
                        <span>
                            <strong>{{ group.company }}</strong>
                            <span v-if="filters.calendarSearch.value">
                                (<i>{{ getSelectedCountInGroup(group) }}</i> /
                                {{ group.items.length }} /
                                {{ group.originalItemCount }})
                            </span>
                            <span v-else>
                                (<i>{{ getSelectedCountInGroup(group) }}</i> /
                                {{ group.originalItemCount }})
                            </span>
                        </span>
                    </AccordionHeader>
                    <AccordionContent>
                        <ToggleButton
                            onLabel="All"
                            offLabel="All"
                            :modelValue="isAllSelectedInGroup(group)"
                            @update:modelValue="toggleAllInGroup(group)"
                            class="p-button-sm p-button-secondary" />
                        <ToggleButton
                            v-for="ticker in group.items"
                            :key="ticker.symbol"
                            :modelValue="isSelected(ticker)"
                            @update:modelValue="toggleTickerSelection(ticker)"
                            :onLabel="ticker.symbol"
                            :offLabel="ticker.symbol"
                            class="p-button-sm" />
                    </AccordionContent>
                </AccordionPanel>
            </Accordion>
        </ScrollPanel>
    </div>
</template>

<script setup>
    import { computed } from 'vue';
    import { useFilterState } from '@/composables/portfolio/useFilterState';

    // PrimeVue 컴포넌트 import
    import Accordion from 'primevue/accordion';
    import AccordionPanel from 'primevue/accordionpanel';
    import AccordionHeader from 'primevue/accordionheader';
    import AccordionContent from 'primevue/accordioncontent';
    import ToggleButton from 'primevue/togglebutton';
    import ScrollPanel from 'primevue/scrollpanel';
    const { filters } = useFilterState();

    const props = defineProps({
        groupedTickers: Array,
        modelValue: Array,
    });
    const emit = defineEmits(['update:modelValue']);

    const filteredGroupedTickers = computed(() => {
        const filterText = filters.value.calendarSearch.value?.toLowerCase();

        if (!filterText) {
            return props.groupedTickers.map((group) => ({
                ...group,
                originalItemCount: group.items.length,
            }));
        }

        return props.groupedTickers
            .map((group) => ({
                ...group,
                items: group.items.filter((ticker) =>
                    ticker.symbol.toLowerCase().includes(filterText)
                ),
                originalItemCount: group.items.length,
            }))
            .filter((group) => group.items.length > 0);
    });

    const isSelected = (ticker) => {
        return props.modelValue.some(
            (selected) => selected.symbol === ticker.symbol
        );
    };

    const toggleTickerSelection = (ticker) => {
        const localSelectedTickers = [...props.modelValue];
        const index = localSelectedTickers.findIndex(
            (selected) => selected.symbol === ticker.symbol
        );
        if (index > -1) {
            localSelectedTickers.splice(index, 1);
        } else {
            localSelectedTickers.push(ticker);
        }
        emit('update:modelValue', localSelectedTickers);
    };

    const getSelectedCountInGroup = (group) => {
        return group.items.filter(isSelected).length;
    };

    const isAllSelectedInGroup = (group) => {
        if (group.items.length === 0) return false;
        return group.items.every(isSelected);
    };

    const toggleAllInGroup = (group) => {
        const localSelectedTickers = [...props.modelValue];
        const allSelected = isAllSelectedInGroup(group);

        if (allSelected) {
            const groupSymbols = group.items.map((t) => t.symbol);
            const newSelection = localSelectedTickers.filter(
                (t) => !groupSymbols.includes(t.symbol)
            );
            emit('update:modelValue', newSelection);
        } else {
            const newTickersToAdd = group.items.filter((t) => !isSelected(t));
            emit('update:modelValue', [
                ...localSelectedTickers,
                ...newTickersToAdd,
            ]);
        }
    };
</script>
