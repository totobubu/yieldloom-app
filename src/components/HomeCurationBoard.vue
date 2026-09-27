<script setup>
import { useRouter } from 'vue-router';
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import Button from 'primevue/button';

const router = useRouter();

// Mock data for curation
const curations = [
  {
    id: 'monthly-dividend',
    title: '💰 매월 배당받는 든든한 지갑',
    description: '안정적인 월배당으로 현금흐름을 창출하는 ETF 모음',
    items: [
      { ticker: 'O', name: 'Realty Income', type: 'REITs', yield: '5.4%', price: '$52.30' },
      { ticker: 'SCHD', name: 'Schwab US Dividend Equity', type: 'Dividend Growth', yield: '3.4%', price: '$78.45' },
      { ticker: 'JEPI', name: 'JPMorgan Equity Premium Income', type: 'Covered Call', yield: '7.8%', price: '$56.20' },
      { ticker: 'DGRW', name: 'WisdomTree US Quality Dividend Growth', type: 'Dividend Growth', yield: '1.8%', price: '$74.15' },
    ]
  },
  {
    id: 'tech-growth',
    title: '🚀 세상의 변화를 이끄는 빅테크',
    description: '미국을 대표하는 기술주와 성장주에 투자하는 ETF',
    items: [
      { ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'Tech', yield: '0.6%', price: '$445.20' },
      { ticker: 'XLK', name: 'Technology Select Sector SPDR', type: 'Tech', yield: '0.7%', price: '$205.10' },
      { ticker: 'VGT', name: 'Vanguard Information Tech', type: 'Tech', yield: '0.6%', price: '$540.30' },
      { ticker: 'SOXX', name: 'iShares Semiconductor', type: 'Semiconductor', yield: '0.7%', price: '$225.50' },
    ]
  },
  {
    id: 'high-yield',
    title: '🔥 고위험 고수익, 초고배당',
    description: '10% 이상의 높은 배당률을 자랑하는 고배당 ETF',
    items: [
      { ticker: 'QYLD', name: 'Global X NASDAQ 100 Covered Call', type: 'Covered Call', yield: '11.5%', price: '$17.50' },
      { ticker: 'XYLD', name: 'Global X S&P 500 Covered Call', type: 'Covered Call', yield: '9.8%', price: '$39.20' },
      { ticker: 'TSLY', name: 'YieldMax TSLA Option Income', type: 'Covered Call', yield: '45.0%', price: '$14.20' },
    ]
  }
];

const navigateToStock = (ticker) => {
  router.push(`/stock/${ticker}`);
};
</script>

<template>
  <div class="curation-board">
    <div v-for="category in curations" :key="category.id" class="curation-category mb-6">
      <div class="category-header mb-3 px-3">
        <h2 class="text-xl font-bold m-0">{{ category.title }}</h2>
        <p class="text-color-secondary text-sm mt-1 mb-0">{{ category.description }}</p>
      </div>
      
      <div class="horizontal-scroll-container flex gap-3 px-3 pb-3">
        <Card v-for="item in category.items" :key="item.ticker" class="etf-card cursor-pointer" @click="navigateToStock(item.ticker)">
          <template #title>
            <div class="flex justify-content-between align-items-center">
              <span class="font-bold text-lg">{{ item.ticker }}</span>
              <Tag :value="item.type" severity="info" rounded></Tag>
            </div>
          </template>
          <template #subtitle>
            <div class="text-sm text-overflow-ellipsis overflow-hidden white-space-nowrap" style="max-width: 200px;">
              {{ item.name }}
            </div>
          </template>
          <template #content>
            <div class="flex flex-column gap-2 mt-2">
              <div class="flex justify-content-between align-items-center">
                <span class="text-sm text-color-secondary">현재가</span>
                <span class="font-bold">{{ item.price }}</span>
              </div>
              <div class="flex justify-content-between align-items-center">
                <span class="text-sm text-color-secondary">배당률</span>
                <span class="font-bold text-green-500">{{ item.yield }}</span>
              </div>
            </div>
          </template>
          <template #footer>
            <Button label="장바구니 담기" icon="pi pi-cart-plus" class="w-full" size="small" outlined />
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.horizontal-scroll-container {
  overflow-x: auto;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  /* Hide scrollbar for a cleaner look */
  scrollbar-width: none; /* Firefox */
}
.horizontal-scroll-container::-webkit-scrollbar {
  display: none; /* Chrome, Safari and Opera */
}

.etf-card {
  min-width: 260px;
  max-width: 260px;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 1px solid var(--surface-border);
}

@media screen and (max-width: 768px) {
  .horizontal-scroll-container {
    padding-bottom: 1rem;
    gap: 0.75rem !important;
  }
  
  .etf-card {
    min-width: 240px;
    max-width: 240px;
  }
}

@media screen and (max-width: 480px) {
  .etf-card {
    min-width: 85vw; /* 모바일에서 카드가 화면 대부분을 차지하도록 설정 */
    max-width: 85vw;
  }
  
  .category-header h2 {
    font-size: 1.1rem !important;
  }
}

.etf-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: var(--primary-color);
}

.etf-card :deep(.p-card-body) {
  padding: 1rem;
}
</style>
