// scripts/migrateAssets.js
// 커맨드라인에서 실행하는 자산 마이그레이션 스크립트
// 사용법:
//   node scripts/migrateAssets.js --dry-run          # 현재 사용자 Dry Run
//   node scripts/migrateAssets.js                    # 현재 사용자 실제 마이그레이션
//   node scripts/migrateAssets.js --all --dry-run    # 모든 사용자 Dry Run
//   node scripts/migrateAssets.js --all              # 모든 사용자 실제 마이그레이션
//   node scripts/migrateAssets.js --user USER_ID     # 특정 사용자 마이그레이션

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, getDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Firebase 설정 로드
const firebaseConfigPath = join(__dirname, '../src/firebase.js');
console.log('Loading Firebase config from:', firebaseConfigPath);

// firebase.js에서 설정 추출 (간단한 방법)
const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyADKsOt9wgF_kEw3yDvXMF3Pp6UpD-rRTA",
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "etf-c9ad9.firebaseapp.com",
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || "etf-c9ad9",
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "etf-c9ad9.appspot.com",
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1043085943631",
    appId: process.env.VITE_FIREBASE_APP_ID || "1:1043085943631:web:d14e16ca2c96e4e90a67b9",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ISIN 매핑 데이터 로드
const loadIsinMapping = () => {
    const mapping = new Map();

    try {
        // US 주식 매핑
        const usStocksPath = join(__dirname, '../src/data/sidebar/us-stocks.json');
        const usStocks = JSON.parse(readFileSync(usStocksPath, 'utf-8'));
        usStocks.forEach(stock => {
            if (stock.isin && stock.symbol) {
                mapping.set(stock.isin, stock.symbol);
            }
        });
        console.log(`✓ Loaded ${usStocks.length} US stocks`);
    } catch (err) {
        console.warn('⚠️  Could not load US stocks:', err.message);
    }

    try {
        // US ETF 매핑
        const usEtfsPath = join(__dirname, '../src/data/sidebar/us-etfs.json');
        const usEtfs = JSON.parse(readFileSync(usEtfsPath, 'utf-8'));
        usEtfs.forEach(etf => {
            if (etf.isin && etf.symbol) {
                mapping.set(etf.isin, etf.symbol);
            }
        });
        console.log(`✓ Loaded ${usEtfs.length} US ETFs`);
    } catch (err) {
        console.warn('⚠️  Could not load US ETFs:', err.message);
    }

    console.log(`📊 Total ISIN mappings: ${mapping.size}\n`);
    return mapping;
};

const isinMapping = loadIsinMapping();

const isinToSymbol = (isin) => {
    return isinMapping.get(isin) || null;
};

const isIsinFormat = (str) => {
    if (!str) return false;
    return /^[A-Z]{2}[A-Z0-9]{10}$/.test(str.trim().toUpperCase());
};

const migrateUserAssets = async (userId, dryRun = true) => {
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

    let batch = writeBatch(db);
    let batchCount = 0;
    const BATCH_LIMIT = 500;

    for (const assetDoc of snapshot.docs) {
        const assetId = assetDoc.id;
        const assetData = assetDoc.data();

        if (assetData.symbol && isIsinFormat(assetData.symbol)) {
            results.needsMigration++;

            const oldSymbol = assetData.symbol;
            console.log(`\n📌 마이그레이션 대상 발견:`);
            console.log(`   Asset ID: ${assetId}`);
            console.log(`   Name: ${assetData.name || 'N/A'}`);
            console.log(`   Current Symbol: ${oldSymbol} (ISIN 형식)`);

            const newSymbol = isinToSymbol(oldSymbol);

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

    if (!dryRun && batchCount > 0) {
        await batch.commit();
        console.log(`\n💾 마지막 Batch committed (${batchCount}개)`);
    }

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
};

const migrateAllUsersAssets = async (dryRun = true) => {
    console.log(`\n🚀 전체 사용자 assets 마이그레이션 시작...`);
    console.log(`모드: ${dryRun ? 'DRY RUN' : '실제 업데이트'}\n`);

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
};

// 커맨드라인 인자 파싱
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const userIndex = args.indexOf('--user');
const userId = userIndex !== -1 ? args[userIndex + 1] : null;

// 메인 실행
(async () => {
    try {
        console.log('🚀 Asset Symbol Migration Script\n');

        if (userId) {
            console.log(`Target: User ${userId}`);
            console.log(`Mode: ${dryRun ? 'DRY RUN' : 'REAL UPDATE'}\n`);
            await migrateUserAssets(userId, dryRun);
        } else if (all) {
            console.log(`Target: All Users`);
            console.log(`Mode: ${dryRun ? 'DRY RUN' : 'REAL UPDATE'}\n`);
            await migrateAllUsersAssets(dryRun);
        } else {
            console.log('❌ Error: Please specify a target:');
            console.log('   --user USER_ID    Migrate specific user');
            console.log('   --all             Migrate all users');
            console.log('\nOptions:');
            console.log('   --dry-run         Test mode (no actual changes)');
            console.log('\nExamples:');
            console.log('   node scripts/migrateAssets.js --user abc123 --dry-run');
            console.log('   node scripts/migrateAssets.js --all --dry-run');
            console.log('   node scripts/migrateAssets.js --all');
            process.exit(1);
        }

        console.log('\n✅ Migration script completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    }
})();
