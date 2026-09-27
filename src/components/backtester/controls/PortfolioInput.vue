<!-- src\components\backtester\controls\PortfolioInput.vue -->
<script setup>
    import { ref } from 'vue';
    import PortfolioItem from './PortfolioItem.vue';

    const props = defineProps({
        modelValue: Array,
        allSymbols: Array, // 이 prop은 국가별로 필터링된 종목 목록입니다.
        getMaxValue: Function,
    });

    const emit = defineEmits(['addItem', 'removeItem', 'update:portfolioItem']);

    const filteredSymbols = ref([]);

    // AutoComplete의 search 이벤트 핸들러
    const searchSymbol = (event) => {
        if (!props.allSymbols) {
            filteredSymbols.value = [];
            return;
        }
        setTimeout(() => {
            if (!event.query.trim().length) {
                filteredSymbols.value = [];
            } else {
                const queryLower = event.query.toLowerCase();
                // [수정] props.allSymbols (필터링된 목록) 내에서 검색
                filteredSymbols.value = props.allSymbols.filter((symbol) => {
                    return symbol.toLowerCase().startsWith(queryLower);
                });
            }
        }, 250);
    };

    const handleAddItem = () => emit('addItem');
    const handleRemoveItem = (index) => emit('removeItem', index);
    const handleUpdateItem = (index, newItem) => {
        // portfolio.value[index] = newItem 과 같은 직접적인 수정 대신 이벤트를 emit합니다.
        emit('update:portfolioItem', index, newItem);
    };
</script>

<template>
    <div class="grid" id="t-backtester-portfolio">
        <div
            v-for="(item, index) in modelValue"
            :key="index"
            class="col-6 md:col-3">
            <!-- [핵심 수정] v-if를 제거하고, 렌더링되지 않아야 할 아이템은 symbol: null로 구분 -->
            <PortfolioItem
                v-if="item.symbol !== null"
                :modelValue="item"
                @update:modelValue="
                    (newItem) => handleUpdateItem(index, newItem)
                "
                :index="index"
                :all-symbols="allSymbols"
                :filtered-symbols="filteredSymbols"
                :max-value="getMaxValue(index)"
                @search="searchSymbol"
                @addItem="handleAddItem"
                @removeItem="handleRemoveItem" />
        </div>
    </div>
</template>
