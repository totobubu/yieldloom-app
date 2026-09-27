// src/composables/useAssetFirestore.js
import { ref } from 'vue';
import {
    collection,
    doc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    deleteField,
    Timestamp,
} from 'firebase/firestore';
import { db } from '@/firebase';
// import { user } from '@/store/auth'; // user는 페이지에서 전달받음

/**
 * Firestore 데이터 구조:
 *
 * userAssets/{userId}/familyMembers/{memberId}
 *   - name: string
 *   - relationship: string (본인, 배우자, 자녀, 부모 등)
 *
 * --------------------------------------------------
 *
 * userAssets/{userId}/familyMembers/{memberId}/accounts/{accountId}
 *   - name: string
 *   - brokerage: string
 *   - accountNumber: string
 *
 * --------------------------------------------------
 *
 * userAssets/{userId}/assets/{isin} or {currency} or {coinid}
 * - type: string (주식, 현금, 코인)
 * - isin?: string (주식일 경우 ISIN 코드)
 * - symbol?: string (주식 심볼)
 * - name?: string (자산명)
 * - currency?: string (KRW, USD 등)
 * - holdings: { [accountId]: { amount: number, avgPrice?: number } }
 * - notes?: string
 *
 * --------------------------------------------------
 *
 * userAssets/{userId}/assets/{isin}/transactions/{transactionId}
 * - tossTransactionId?: string (토스증권 거래내역서 발급번호)
 * - accountId: string (어느 계좌의 거래인지)
 * - date: timestamp (거래일자)
 * - brokerage?: string (증권사명)
 * - type: string (정규화된 타입: buy, sell, dividend, deposit, withdrawal, exchange, interest, event, unknown)
 * - rawType: string (원본 거래 타입)
 * - currency: string (거래 통화: "USD", "KRW")
 * - quantity?: number (거래수량)
 * - price?: number (KRW 기준 단가)
 * - amount: number (KRW 기준 거래대금, 총 금액)
 * - commission?: number (수수료)
 * - tax?: number (제세금)
 * - taxFree?: number (변제/연체합)
 * - balance?: number (잔고)
 * - balanceAmount?: number (잔액)
 * - notes?: string
 *
 * // USD 거래인 경우
 * - priceUSD?: number (USD 기준 단가)
 * - amountUSD?: number (USD 기준 거래대금, 총 금액)
 * - exchangeRate?: number (환율)
 * - commissionUSD?: number (USD 기준 수수료)
 * - taxUSD?: number (USD 기준 제세금)
 * - taxFreeUSD?: number (USD 기준 변제/연체합)
 * - balanceUSD?: number (USD 기준 잔고)
 * - balanceAmountUSD?: number (USD 기준 잔액)
 */

/**
 * 가족 멤버 관리
 */
export const useFamilyMembers = () => {
    const familyMembers = ref([]);
    const isLoading = ref(false);

    const loadFamilyMembers = async (userId) => {
        if (!userId) return;
        console.log('📥 loadFamilyMembers called with userId:', userId);
        isLoading.value = true;
        try {
            const membersRef = collection(
                db,
                `userAssets/${userId}/familyMembers`
            );
            const snapshot = await getDocs(membersRef);
            const data = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
            console.log('📊 Loaded data:', data);
            familyMembers.value = data;
            console.log('✅ familyMembers.value updated:', familyMembers.value);
        } catch (error) {
            console.error('가족 멤버 불러오기 실패:', error);
        } finally {
            isLoading.value = false;
        }
    };

    const addFamilyMember = async (userId, memberData) => {
        if (!userId) return;
        try {
            const membersRef = collection(
                db,
                `userAssets/${userId}/familyMembers`
            );
            const docRef = await addDoc(membersRef, {
                ...memberData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('가족 멤버 추가 실패:', error);
            throw error;
        }
    };

    const updateFamilyMember = async (userId, memberId, memberData) => {
        if (!userId) return;
        try {
            const memberRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}`
            );
            await updateDoc(memberRef, memberData);
        } catch (error) {
            console.error('가족 멤버 수정 실패:', error);
            throw error;
        }
    };

    const deleteFamilyMember = async (userId, memberId) => {
        if (!userId) return;
        try {
            // 서브컬렉션도 함께 삭제해야 함 (Firestore는 자동으로 서브컬렉션을 삭제하지 않음)
            const memberRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}`
            );
            await deleteDoc(memberRef);
        } catch (error) {
            console.error('가족 멤버 삭제 실패:', error);
            throw error;
        }
    };

    return {
        familyMembers,
        isLoading,
        loadFamilyMembers,
        addFamilyMember,
        updateFamilyMember,
        deleteFamilyMember,
    };
};

/**
 * 증권사 관리
 */
export const useBrokerages = () => {
    const isLoading = ref(false);

    const loadBrokerages = async (userId, memberId) => {
        if (!userId || !memberId) return [];
        isLoading.value = true;
        try {
            const brokeragesRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages`
            );
            const snapshot = await getDocs(brokeragesRef);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
        } catch (error) {
            console.error('증권사 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const addBrokerage = async (userId, memberId, brokerageData) => {
        if (!userId || !memberId) return;
        try {
            const brokeragesRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages`
            );
            const docRef = await addDoc(brokeragesRef, {
                ...brokerageData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('증권사 추가 실패:', error);
            throw error;
        }
    };

    const updateBrokerage = async (
        userId,
        memberId,
        brokerageId,
        brokerageData
    ) => {
        if (!userId || !memberId) return;
        try {
            const brokerageRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}`
            );
            await updateDoc(brokerageRef, brokerageData);
        } catch (error) {
            console.error('증권사 수정 실패:', error);
            throw error;
        }
    };

    const deleteBrokerage = async (userId, memberId, brokerageId) => {
        if (!userId || !memberId) return;
        try {
            const brokerageRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}`
            );
            await deleteDoc(brokerageRef);
        } catch (error) {
            console.error('증권사 삭제 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadBrokerages,
        addBrokerage,
        updateBrokerage,
        deleteBrokerage,
    };
};

/**
 * 계좌 관리
 */
export const useAccounts = () => {
    const isLoading = ref(false);

    const loadAccounts = async (userId, memberId) => {
        if (!userId || !memberId) return [];
        isLoading.value = true;
        try {
            const accountsRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts`
            );
            const snapshot = await getDocs(accountsRef);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
        } catch (error) {
            console.error('계좌 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const addAccount = async (userId, memberId, accountData) => {
        if (!userId || !memberId) return;
        try {
            const accountsRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts`
            );
            const docRef = await addDoc(accountsRef, {
                ...accountData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('계좌 추가 실패:', error);
            throw error;
        }
    };

    const updateAccount = async (userId, memberId, accountId, accountData) => {
        if (!userId || !memberId) return;
        try {
            const accountRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts/${accountId}`
            );
            await updateDoc(accountRef, accountData);
        } catch (error) {
            console.error('계좌 수정 실패:', error);
            throw error;
        }
    };

    const deleteAccount = async (userId, memberId, accountId) => {
        if (!userId || !memberId) return;
        try {
            const accountRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts/${accountId}`
            );
            await deleteDoc(accountRef);
        } catch (error) {
            console.error('계좌 삭제 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadAccounts,
        addAccount,
        updateAccount,
        deleteAccount,
    };
};

/**
 * 자산 항목 관리 (Asset-Centric Structure)
 * Assets are stored at: userAssets/{userId}/assets/{assetId}
 * where assetId is ISIN for stocks or currency code for cash
 */
export const useAssets = () => {
    const isLoading = ref(false);

    /**
     * Load all assets for a user
     * @param {string} userId
     * @returns {Array} Array of assets with their IDs
     */
    const loadAssets = async (userId) => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const snapshot = await getDocs(assetsRef);
            return snapshot.docs.map((doc) => ({
                id: doc.id, // This is the ISIN or currency code
                ...doc.data(),
            }));
        } catch (error) {
            console.error('자산 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    /**
     * Load stocks only
     * @param {string} userId
     * @returns {Array} Array of stock assets
     */
    const loadStocks = async (userId) => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const q = query(assetsRef, where('type', '==', '주식'));
            const snapshot = await getDocs(q);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
        } catch (error) {
            console.error('주식 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    /**
     * Load cash/deposits only
     * @param {string} userId
     * @returns {Array} Array of cash assets
     */
    const loadCash = async (userId) => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const q = query(assetsRef, where('type', '==', '현금'));
            const snapshot = await getDocs(q);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
        } catch (error) {
            console.error('현금 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    /**
     * Load coins only
     * @param {string} userId
     * @returns {Array} Array of coin assets
     */
    const loadCoins = async (userId) => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const q = query(assetsRef, where('type', '==', '코인'));
            const snapshot = await getDocs(q);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
        } catch (error) {
            console.error('코인 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    /**
     * Add or update an asset
     * Uses ISIN for stocks, currency code for cash as document ID
     * @param {string} userId
     * @param {object} assetData - Must include type, and either isin or currency
     * @returns {string} The asset ID (ISIN or currency)
     */
    const addAsset = async (userId, assetData) => {
        if (!userId) return;
        try {
            // Determine asset ID based on type
            let assetId;
            if (assetData.type === '주식') {
                if (assetData.isin) {
                    assetId = assetData.isin;
                } else if (assetData.symbol) {
                    assetId = `STOCK_${assetData.symbol}`;
                }
            } else if (assetData.type === '현금' && assetData.currency) {
                assetId = `CASH_${assetData.currency}`;
            } else if (assetData.type === '코인' && assetData.symbol) {
                assetId = `COIN_${assetData.symbol}`;
            }

            if (!assetId) {
                throw new Error(
                    'Invalid asset data: missing isin, currency, or symbol'
                );
            }

            const assetRef = doc(db, `userAssets/${userId}/assets`, assetId);

            // Remove undefined fields from assetData
            const sanitizedData = Object.fromEntries(
                Object.entries(assetData).filter(([_, v]) => v !== undefined)
            );

            // Use setDoc with merge to update if exists
            await setDoc(
                assetRef,
                {
                    ...sanitizedData,
                    updatedAt: new Date(),
                },
                { merge: true }
            );

            return assetId;
        } catch (error) {
            console.error('자산 추가 실패:', error);
            throw error;
        }
    };

    /**
     * Update an existing asset
     * @param {string} userId
     * @param {string} assetId - ISIN or currency code
     * @param {object} assetData
     */
    const updateAsset = async (userId, assetId, assetData) => {
        if (!userId || !assetId) return;
        try {
            const assetRef = doc(db, `userAssets/${userId}/assets/${assetId}`);
            await updateDoc(assetRef, {
                ...assetData,
                updatedAt: new Date(),
            });
        } catch (error) {
            console.error('자산 수정 실패:', error);
            throw error;
        }
    };

    /**
     * Delete an asset and all its transactions
     * @param {string} userId
     * @param {string} assetId - ISIN or currency code
     */
    const deleteAsset = async (userId, assetId) => {
        if (!userId || !assetId) return;
        try {
            // Note: This doesn't delete subcollections automatically
            // You may need to delete transactions separately or use Cloud Functions
            const assetRef = doc(db, `userAssets/${userId}/assets/${assetId}`);
            await deleteDoc(assetRef);
        } catch (error) {
            console.error('자산 삭제 실패:', error);
            throw error;
        }
    };

    /**
     * Delete a holding from an asset
     * @param {string} userId
     * @param {string} assetId
     * @param {string} accountId
     */
    const deleteAssetHolding = async (userId, assetId, accountId) => {
        if (!userId || !assetId || !accountId) return;
        try {
            const assetRef = doc(db, `userAssets/${userId}/assets/${assetId}`);
            await updateDoc(assetRef, {
                [`holdings.${accountId}`]: deleteField(),
                updatedAt: new Date(),
            });
        } catch (error) {
            console.error('자산 보유 내역 삭제 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadAssets,
        addAsset,
        updateAsset,
        deleteAsset,
        deleteAssetHolding,
    };
};

/**
 * 거래 내역 관리 (Asset-Centric Structure)
 * Transactions are stored at: userAssets/{userId}/assets/{assetId}/transactions/{txId}
 * Each transaction includes accountId to track which account it belongs to
 */
export const useTransactions = () => {
    const isLoading = ref(false);

    /**
     * Load transactions for a specific asset
     * @param {string} userId
     * @param {string} assetId - ISIN or currency code
     * @param {string} accountId - Optional: filter by account
     * @param {number} monthsBack - Optional: number of months to look back (default: 3)
     * @returns {Array} Array of transactions
     */
    const loadTransactions = async (
        userId,
        assetId,
        accountId = null,
        monthsBack = 3
    ) => {
        if (!userId || !assetId) return [];
        isLoading.value = true;
        try {
            const transactionsRef = collection(
                db,
                `userAssets/${userId}/assets/${assetId}/transactions`
            );

            // Try to fetch all transactions first (client-side filtering is more reliable)
            // since date field format may vary
            const snapshot = await getDocs(transactionsRef);
            let transactions = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));

            // Client-side date filtering if monthsBack is specified
            if (monthsBack !== null) {
                const cutoffDate = new Date();
                cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

                transactions = transactions.filter((tx) => {
                    if (!tx.date) return true; // Include if no date

                    let transactionDate;
                    // Firestore Timestamp
                    if (tx.date.toDate) {
                        transactionDate = tx.date.toDate();
                    }
                    // YYYYMMDD string format
                    else if (
                        typeof tx.date === 'string' &&
                        tx.date.length === 8
                    ) {
                        const year = parseInt(tx.date.substring(0, 4));
                        const month = parseInt(tx.date.substring(4, 6)) - 1;
                        const day = parseInt(tx.date.substring(6, 8));
                        transactionDate = new Date(year, month, day);
                    }
                    // Date object
                    else if (tx.date instanceof Date) {
                        transactionDate = tx.date;
                    } else {
                        return true; // Include if can't parse
                    }

                    return transactionDate >= cutoffDate;
                });
            }

            // Filter by accountId if provided
            if (accountId) {
                transactions = transactions.filter(
                    (tx) => tx.accountId === accountId
                );
            }

            // Sort by date descending
            transactions.sort((a, b) => {
                const getDateValue = (tx) => {
                    if (!tx.date) return 0;
                    if (tx.date.toDate) return tx.date.toDate().getTime();
                    if (typeof tx.date === 'string' && tx.date.length === 8) {
                        const year = parseInt(tx.date.substring(0, 4));
                        const month = parseInt(tx.date.substring(4, 6)) - 1;
                        const day = parseInt(tx.date.substring(6, 8));
                        return new Date(year, month, day).getTime();
                    }
                    if (tx.date instanceof Date) return tx.date.getTime();
                    return 0;
                };
                return getDateValue(b) - getDateValue(a);
            });

            return transactions;
        } catch (error) {
            console.error('거래 내역 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    /**
     * Add a transaction to an asset
     * @param {string} userId
     * @param {string} assetId - ISIN or currency code
     * @param {object} transactionData - Must include accountId
     * @returns {string} Transaction ID
     */
    const addTransaction = async (userId, assetId, transactionData) => {
        if (!userId || !assetId) return;
        if (!transactionData.accountId) {
            throw new Error('Transaction must include accountId');
        }

        try {
            const transactionsRef = collection(
                db,
                `userAssets/${userId}/assets/${assetId}/transactions`
            );
            const docRef = await addDoc(transactionsRef, {
                ...transactionData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('거래 내역 추가 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadTransactions,
        addTransaction,
    };
};
