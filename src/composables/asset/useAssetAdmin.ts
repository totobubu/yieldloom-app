// src/composables/asset/useAssetAdmin.ts
// 관리자용 자산 관리 기능

import { ref, type Ref } from 'vue';
import {
    collectionGroup,
    query,
    where,
    getDocs,
    updateDoc,
    doc,
} from 'firebase/firestore';
import { db, auth } from '@/firebase';
import { saveStockMapping } from '@/composables/data/useStockMapping';

/**
 * 승인 대기 자산 정보
 */
export interface PendingApproval {
    id: string;
    userId: string;
    memberId: string;
    brokerageId: string;
    accountId: string;
    koName?: string;
    symbol?: string;
    isin?: string;
    koNameApprovalStatus?: 'pending' | 'approved' | 'rejected';
    [key: string]: any;
}

/**
 * 승인 대기 중인 koName 목록 조회
 */
export interface UseKoNameApprovalsReturn {
    pendingApprovals: Ref<PendingApproval[]>;
    isLoading: Ref<boolean>;
    loadPendingApprovals: () => Promise<void>;
}

export const useKoNameApprovals = (): UseKoNameApprovalsReturn => {
    const pendingApprovals = ref<PendingApproval[]>([]);
    const isLoading = ref(false);

    const loadPendingApprovals = async (): Promise<void> => {
        isLoading.value = true;
        pendingApprovals.value = [];

        try {
            console.log('🔍 승인 대기 목록 조회 시작...');

            // collectionGroup을 사용하여 모든 사용자의 assets 서브컬렉션 조회
            const assetsRef = collectionGroup(db, 'assets');
            const q = query(
                assetsRef,
                where('koNameApprovalStatus', '==', 'pending')
            );

            console.log('📊 쿼리 실행 중...');
            const snapshot = await getDocs(q);
            console.log('✅ 쿼리 완료. 문서 개수:', snapshot.size);

            const approvals: PendingApproval[] = [];

            snapshot.forEach((docSnapshot) => {
                const data = docSnapshot.data();
                const pathParts = docSnapshot.ref.path.split('/');

                console.log('📄 문서 경로:', docSnapshot.ref.path);
                console.log('📄 문서 데이터:', data);

                // 경로에서 userId, memberId, brokerageId, accountId 추출
                // userAssets/{userId}/familyMembers/{memberId}/brokerages/{brokerageId}/accounts/{accountId}/assets/{assetId}
                const userId = pathParts[1];
                const memberId = pathParts[3];
                const brokerageId = pathParts[5];
                const accountId = pathParts[7];
                const assetId = docSnapshot.id;

                approvals.push({
                    id: assetId,
                    userId,
                    memberId,
                    brokerageId,
                    accountId,
                    ...data,
                });
            });

            console.log('✅ 승인 대기 항목:', approvals);
            pendingApprovals.value = approvals;
        } catch (error) {
            console.error('❌ 승인 대기 목록 조회 실패:', error);
            console.error('❌ 에러 상세:', {
                message: (error as Error).message,
                code: (error as any).code,
                stack: (error as Error).stack,
            });
            // collectionGroup 쿼리가 실패할 경우 (인덱스 미설정 등)
            // 빈 배열 반환
            pendingApprovals.value = [];
            throw error; // 에러를 다시 throw하여 UI에서 처리할 수 있도록
        } finally {
            isLoading.value = false;
        }
    };

    return {
        pendingApprovals,
        isLoading,
        loadPendingApprovals,
    };
};

/**
 * koName 승인 처리
 * 승인 시 해당 symbol의 정식 koName으로 사용할 수 있도록 업데이트
 */
export const approveKoName = async (
    userId: string,
    memberId: string,
    brokerageId: string,
    accountId: string,
    assetId: string,
    koName: string,
    symbol: string,
    isin: string
): Promise<boolean> => {
    try {
        const assetRef = doc(
            db,
            `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}/accounts/${accountId}/assets/${assetId}`
        );

        await updateDoc(assetRef, {
            koNameApprovalStatus: 'approved',
            koName: koName,
            approvedAt: new Date(),
        });

        // stockMappings 컬렉션에 매핑 정보 저장 (ISIN 기반, 최적화된 구조)
        if (symbol && koName && isin) {
            await saveStockMapping(
                isin,
                {
                    koName: koName,
                    symbol: symbol,
                },
                auth.currentUser?.uid || 'admin'
            );
        }

        return true;
    } catch (error) {
        console.error('koName 승인 실패:', error);
        throw error;
    }
};

/**
 * koName 거부 처리
 */
export const rejectKoName = async (
    userId: string,
    memberId: string,
    brokerageId: string,
    accountId: string,
    assetId: string
): Promise<boolean> => {
    try {
        const assetRef = doc(
            db,
            `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}/accounts/${accountId}/assets/${assetId}`
        );

        await updateDoc(assetRef, {
            koNameApprovalStatus: 'rejected',
            rejectedAt: new Date(),
        });

        return true;
    } catch (error) {
        console.error('koName 거부 실패:', error);
        throw error;
    }
};

/**
 * 기존 승인된 항목들을 stockMappings로 동기화
 */
export const syncApprovedToMappings = async (): Promise<number> => {
    let count = 0;
    try {
        console.log('🔄 승인된 항목 동기화 시작...');
        const assetsRef = collectionGroup(db, 'assets');
        const q = query(
            assetsRef,
            where('koNameApprovalStatus', '==', 'approved')
        );

        const snapshot = await getDocs(q);
        console.log(`📊 승인된 항목 ${snapshot.size}개 발견`);

        for (const docSnapshot of snapshot.docs) {
            const data = docSnapshot.data();

            if (data.symbol && data.koName && data.isin) {
                await saveStockMapping(
                    data.isin,
                    {
                        koName: data.koName,
                        symbol: data.symbol,
                    },
                    auth.currentUser?.uid || 'admin'
                );
                count++;
            }
        }

        console.log(`✅ ${count}개 항목 동기화 완료`);
        return count;
    } catch (error) {
        console.error('동기화 실패:', error);
        throw error;
    }
};
