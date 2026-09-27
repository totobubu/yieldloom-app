<template>
  <div class="portfolio-view max-w-screen-xl mx-auto p-4 md:p-6">
    <div class="flex align-items-center justify-content-between mb-4">
      <div>
        <h1 class="text-3xl font-bold m-0 text-900">내 배당 포트폴리오</h1>
        <p class="text-600 mt-2 mb-0">보유 중인 주식을 등록하고 매월 예상되는 배당금을 확인하세요.</p>
      </div>
      <div>
        <SelectButton v-model="selectedCurrency" :options="currencyOptions" aria-labelledby="basic" />
      </div>
    </div>

    <div class="grid">
      <!-- 좌측: 차트 및 자산 요약 -->
      <div class="col-12 lg:col-8">
        <div class="surface-card p-4 border-round shadow-2 mb-4">
          <div class="flex justify-content-between align-items-center mb-4">
            <h2 class="text-xl font-semibold m-0">올해 예상 총 배당금</h2>
            <div class="text-2xl font-bold text-green-600">
              {{ selectedCurrency === 'KRW' ? '₩' : '$' }}{{ selectedCurrency === 'KRW' ? Math.floor(totalExpectedDividend).toLocaleString() : totalExpectedDividend.toFixed(2) }}
            </div>
          </div>
          <DividendChart :monthly-data="monthlyDividends" :currency="selectedCurrency" />
        </div>
      </div>

      <!-- 우측: 보유 종목 리스트 및 추가 -->
      <div class="col-12 lg:col-4">
        <div class="surface-card p-4 border-round shadow-2 h-full flex flex-column">
          <h2 class="text-xl font-semibold m-0 mb-3">보유 종목 관리</h2>
          
          <form @submit.prevent="addHolding" class="flex gap-2 mb-4">
            <span class="p-input-icon-left flex-1">
              <i class="pi pi-search" />
              <InputText v-model="newHolding.ticker" placeholder="티커 (예: AAPL)" class="w-full" required />
            </span>
            <InputNumber v-model="newHolding.quantity" placeholder="수량" class="w-5rem" :min="1" required />
            <Button type="submit" icon="pi pi-plus" class="p-button-primary" aria-label="추가" />
          </form>

          <div v-if="loading" class="flex justify-content-center py-4">
            <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
          </div>

          <div v-else-if="holdings.length === 0" class="text-center text-500 py-4 flex-1 flex align-items-center justify-content-center">
            보유 중인 종목이 없습니다.<br/>위에서 티커를 검색해 추가해보세요!
          </div>

          <div v-else class="flex-1 overflow-auto">
            <ul class="list-none p-0 m-0">
              <li v-for="item in holdings" :key="item.id" class="flex align-items-center justify-content-between py-3 border-bottom-1 surface-border">
                <div>
                  <div class="font-bold text-900">{{ item.ticker }}</div>
                  <div class="text-500 text-sm">{{ item.quantity }}주</div>
                </div>
                <div class="flex align-items-center gap-3">
                  <!-- 예상 배당금 (실제 데이터 기반) -->
                  <div class="text-right">
                    <div class="text-900 font-semibold text-sm">예상 연 배당</div>
                    <div class="text-green-600 font-bold">
                      {{ expectedAnnualDividends[item.id] ? (selectedCurrency === 'KRW' ? '₩' + Math.floor(expectedAnnualDividends[item.id]).toLocaleString() : '$' + expectedAnnualDividends[item.id].toFixed(2)) : '--' }}
                    </div>
                  </div>
                  <Button icon="pi pi-trash" class="p-button-rounded p-button-danger p-button-text p-button-sm" @click="removeHolding(item.id)" />
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { db, auth } from '@/firebase';
import { collection, query, getDocs, addDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import DividendChart from '@/components/portfolio/DividendChart.vue';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import { getDataUrl } from '@/utils/dataUrl';
import { useExchangeRates } from '@/composables/data/useExchangeRates';

const { findRateForDate } = useExchangeRates();

const holdings = ref([]);
const loading = ref(true);
const currentUser = ref(null);
const navData = ref(null);

const newHolding = ref({
  ticker: '',
  quantity: null,
});

const currencyOptions = ref(['USD', 'KRW']);
const selectedCurrency = ref('USD');

const monthlyDividends = ref(Array(12).fill(0));
const expectedAnnualDividends = ref({}); // { ticker: totalExpectedAmount }

const totalExpectedDividend = computed(() => {
  return monthlyDividends.value.reduce((sum, val) => sum + val, 0);
});

let unsubscribeSnapshot = null;

onMounted(async () => {
  try {
    const navRes = await fetch(getDataUrl('nav.json'));
    if (navRes.ok) {
      navData.value = await navRes.json();
    }
  } catch (e) {
    console.error('Failed to load nav.json', e);
  }

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser.value = user;
      fetchHoldings(user.uid);
    } else {
      loading.value = false;
    }
  });
});

const fetchHoldings = (uid) => {
  loading.value = true;
  const q = query(collection(db, 'users', uid, 'holdings'));
  
  unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
    holdings.value = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    loading.value = false;
  }, (error) => {
    console.error("포트폴리오 불러오기 실패:", error);
    loading.value = false;
  });
};

const calculateDividends = async () => {
  if (!navData.value || holdings.value.length === 0) {
    monthlyDividends.value = Array(12).fill(0);
    expectedAnnualDividends.value = {};
    return;
  }

  const newMonthly = Array(12).fill(0);
  const newExpected = {};
  
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const isKRW = selectedCurrency.value === 'KRW';

  for (const holding of holdings.value) {
    let totalForTicker = 0;
    const ticker = holding.ticker.toUpperCase();
    
    const navInfo = navData.value.nav.find(
      (item) => item.symbol.toUpperCase() === ticker || item.yfSymbol?.toUpperCase() === ticker
    );

    if (navInfo && navInfo.dataPaths && navInfo.dataPaths.length > 0) {
      try {
        const dataRes = await fetch(getDataUrl(navInfo.dataPaths[0]));
        if (dataRes.ok) {
          const staticData = await dataRes.json();
          const backtestData = staticData.backtestData || [];
          
          const dividends = backtestData.filter(d => 
            (d.amount !== undefined || d.amountFixed !== undefined) && 
            new Date(d.date) >= oneYearAgo
          );

          for (const d of dividends) {
            let amount = d.amountFixed ?? d.amount ?? 0;
            const dateObj = new Date(d.date);
            const month = dateObj.getMonth();
            
            if (isKRW) {
              const rate = await findRateForDate(dateObj);
              if (rate) amount *= rate;
              // 환율 정보가 없는 날짜라면 그대로 USD 금액으로 계산되는 것을 방지하기 위해, 필요시 최신 환율로 fallback 할 수 있으나
              // useExchangeRates가 과거 7일까지 재탐색하므로 웬만하면 값이 존재함.
            }
            
            const totalAmount = amount * holding.quantity;
            newMonthly[month] += totalAmount;
            totalForTicker += totalAmount;
          }
        }
      } catch (e) {
        console.error(`Failed to load data for ${ticker}`, e);
      }
    }
    newExpected[holding.id] = totalForTicker;
  }
  
  monthlyDividends.value = newMonthly;
  expectedAnnualDividends.value = newExpected;
};

watch([holdings, selectedCurrency], () => {
  calculateDividends();
}, { deep: true });

const addHolding = async () => {
  if (!currentUser.value || !newHolding.value.ticker || !newHolding.value.quantity) return;
  
  try {
    const ticker = newHolding.value.ticker.toUpperCase();
    await addDoc(collection(db, 'users', currentUser.value.uid, 'holdings'), {
      ticker: ticker,
      quantity: newHolding.value.quantity,
      addedAt: new Date()
    });
    newHolding.value.ticker = '';
    newHolding.value.quantity = null;
  } catch (error) {
    console.error("종목 추가 실패:", error);
  }
};

const removeHolding = async (id) => {
  if (!currentUser.value) return;
  if (!confirm('이 종목을 포트폴리오에서 삭제하시겠습니까?')) return;
  
  try {
    await deleteDoc(doc(db, 'users', currentUser.value.uid, 'holdings', id));
  } catch (error) {
    console.error("종목 삭제 실패:", error);
  }
};
</script>

<style scoped>
.portfolio-view {
  min-height: calc(100vh - 80px);
}
</style>
