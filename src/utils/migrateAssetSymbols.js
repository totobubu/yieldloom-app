// src/utils/migrateAssetSymbols.js
// Firebase assets 컬렉션에서 symbol이 ISIN으로 잘못 저장된 것을 실제 symbol로 마이그레이션

import { db } from '@/firebase';
import { collection, getDocs, getDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { isinToSymbol } from './isinMapping.js';

/**
 * ISIN 형식인지 확인 (예: US56035L1044)
 * @param {string} str
 * @returns {boolean}
 */
function isIsinFormat(str) {
    if (!str) return false;
    // ISIN은 2자리 국가코드 + 10자리 영숫자
    return /^[A-Z]{2}[A-Z0-9]{10}$/.test(str.trim().toUpperCase());
}

/**
 * 단일 사용자의 assets를 마이그레이션
 * @param {string} userId
 * @param {boolean} dryRun - true면 실제로 업데이트하지 않고 로그만 출력
 * @returns {Promise<object>} 마이그레이션 결과
 */
export async function migrateUserAssets(userId, dryRun = true) {
    console.log(`\n========================================`);
    console.log(`🔍 사용자 ${userId}의 assets 마이그레이션 시작...`);
    console.log(`모드: ${dryRun ? 'DRY RUN (실제 변경 안 함)' : '실제 업데이트'}`);
    console.log(`========================================\n`);

    const assetsRef = collection(db, `userAssets/${userId}/assets`);
    const snapshot = await getDocs(assetsRef);

    const results = {
        total: snapshot.size,
        needsMigration: 0,
        migrated: 0,
        failed: 0,
        details: [],
    };

    console.log(`📊 총 ${snapshot.size}개의 자산 문서 발견\n`);

    // Batch 작업을 위한 준비
    let batch = writeBatch(db);
    let batchCount = 0;
    const BATCH_LIMIT = 500; // Firestore batch 제한

    for (const assetDoc of snapshot.docs) {
        const assetId = assetDoc.id;
        const assetData = assetDoc.data();

        // symbol 필드가 ISIN 형식인지 확인
        if (assetData.symbol && isIsinFormat(assetData.symbol)) {
            results.needsMigration++;

            const oldSymbol = assetData.symbol;
            console.log(`\n📌 마이그레이션 대상 발견:`);
            console.log(`   Asset ID: ${assetId}`);
            console.log(`   Name: ${assetData.name || 'N/A'}`);
            console.log(`   Current Symbol: ${oldSymbol} (ISIN 형식)`);

            // ISIN을 실제 symbol로 변환
            const newSymbol = await isinToSymbol(oldSymbol);

            if (newSymbol) {
                console.log(`   ✅ New Symbol: ${newSymbol}`);

                const detail = {
                    assetId,
                    name: assetData.name,
                    oldSymbol,
                    newSymbol,
                    status: 'ready',
                };

                if (!dryRun) {
                    try {
                        const assetDocRef = doc(db, `userAssets/${userId}/assets`, assetId);
                        batch.update(assetDocRef, { symbol: newSymbol });
                        batchCount++;

                        // Batch 제한에 도달하면 커밋
                        if (batchCount >= BATCH_LIMIT) {
                            await batch.commit();
                            console.log(`   💾 Batch ${Math.floor(results.migrated / BATCH_LIMIT) + 1} committed`);
                            batch = writeBatch(db);
                            batchCount = 0;
                        }

                        detail.status = 'migrated';
                        results.migrated++;
                        console.log(`   ✅ 업데이트 완료`);
                    } catch (error) {
                        detail.status = 'failed';
                        detail.error = error.message;
                        results.failed++;
                        console.error(`   ❌ 업데이트 실패:`, error.message);
                    }
                } else {
                    detail.status = 'dry-run';
                    console.log(`   🔍 DRY RUN: 업데이트하지 않음`);
                }

                results.details.push(detail);
            } else {
                console.log(`   ⚠️  매핑을 찾을 수 없음 (ISIN: ${oldSymbol})`);
                results.details.push({
                    assetId,
                    name: assetData.name,
                    oldSymbol,
                    newSymbol: null,
                    status: 'no-mapping',
                });
                results.failed++;
            }
        }
    }

    // 남은 batch 커밋
    if (!dryRun && batchCount > 0) {
        await batch.commit();
        console.log(`\n💾 마지막 Batch committed (${batchCount}개)`);
    }

    // 결과 요약
    console.log(`\n========================================`);
    console.log(`📊 마이그레이션 결과 요약`);
    console.log(`========================================`);
    console.log(`총 자산 수: ${results.total}`);
    console.log(`마이그레이션 필요: ${results.needsMigration}`);
    if (!dryRun) {
        console.log(`✅ 성공: ${results.migrated}`);
        console.log(`❌ 실패: ${results.failed}`);
    }
    console.log(`========================================\n`);

    return results;
}

/**
 * 모든 사용자의 assets를 마이그레이션
 * @param {boolean} dryRun
 * @returns {Promise<object>} 전체 마이그레이션 결과
 */
export async function migrateAllUsersAssets(dryRun = true) {
    console.log(`\n🚀 전체 사용자 assets 마이그레이션 시작...`);
    console.log(`모드: ${dryRun ? 'DRY RUN' : '실제 업데이트'}\n`);

    // userAssets 컬렉션의 모든 사용자 ID 가져오기
    const userAssetsRef = collection(db, 'userAssets');
    const userSnapshot = await getDocs(userAssetsRef);

    const allResults = {
        totalUsers: userSnapshot.size,
        userResults: [],
    };

    for (const userDoc of userSnapshot.docs) {
        const userId = userDoc.id;
        const userResult = await migrateUserAssets(userId, dryRun);
        allResults.userResults.push({
            userId,
            ...userResult,
        });
    }

    // 전체 요약
    const totalAssets = allResults.userResults.reduce((sum, r) => sum + r.total, 0);
    const totalNeedsMigration = allResults.userResults.reduce((sum, r) => sum + r.needsMigration, 0);
    const totalMigrated = allResults.userResults.reduce((sum, r) => sum + r.migrated, 0);
    const totalFailed = allResults.userResults.reduce((sum, r) => sum + r.failed, 0);

    console.log(`\n========================================`);
    console.log(`🎉 전체 마이그레이션 완료`);
    console.log(`========================================`);
    console.log(`총 사용자 수: ${allResults.totalUsers}`);
    console.log(`총 자산 수: ${totalAssets}`);
    console.log(`마이그레이션 필요: ${totalNeedsMigration}`);
    if (!dryRun) {
        console.log(`✅ 성공: ${totalMigrated}`);
        console.log(`❌ 실패: ${totalFailed}`);
    }
    console.log(`========================================\n`);

    return allResults;
}

/**
 * 특정 asset의 symbol을 확인하고 필요시 마이그레이션
 * @param {string} userId
 * @param {string} assetId
 * @param {boolean} dryRun
 */
export async function migrateSingleAsset(userId, assetId, dryRun = true) {
    const assetRef = doc(db, `userAssets/${userId}/assets`, assetId);
    const assetDoc = await getDoc(assetRef);

    if (!assetDoc.exists()) {
        console.error(`❌ Asset not found: ${assetId}`);
        return null;
    }

    const assetData = assetDoc.data();

    if (!assetData.symbol || !isIsinFormat(assetData.symbol)) {
        console.log(`ℹ️  Asset ${assetId}는 마이그레이션이 필요하지 않습니다.`);
        console.log(`   Current symbol: ${assetData.symbol}`);
        return null;
    }

    const oldSymbol = assetData.symbol;
    const newSymbol = await isinToSymbol(oldSymbol);

    console.log(`\n📌 Asset: ${assetId}`);
    console.log(`   Name: ${assetData.name}`);
    console.log(`   Old Symbol: ${oldSymbol} (ISIN)`);
    console.log(`   New Symbol: ${newSymbol || 'NOT FOUND'}`);

    if (newSymbol && !dryRun) {
        await updateDoc(assetRef, { symbol: newSymbol });
        console.log(`   ✅ Updated!`);
        return { oldSymbol, newSymbol, status: 'success' };
    }

    return { oldSymbol, newSymbol, status: dryRun ? 'dry-run' : 'no-mapping' };
}
