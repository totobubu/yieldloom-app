// scripts/migration/fix-asset-symbols.js
// Firebase의 userAssets에서 잘못된 symbol을 sidebar-tickers.json 기준으로 수정하는 마이그레이션 스크립트

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin SDK 초기화
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
    console.error('❌ serviceAccountKey.json 파일을 찾을 수 없습니다.');
    console.error('   경로:', serviceAccountPath);
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

console.log('🔧 Firebase 프로젝트 정보:');
console.log(`   프로젝트 ID: ${serviceAccount.project_id}`);
console.log(`   클라이언트 이메일: ${serviceAccount.client_email}`);

initializeApp({
    credential: cert(serviceAccount),
});

const db = getFirestore();

// sidebar-tickers.json 로드
const sidebarTickersPath = path.join(
    __dirname,
    '../../public/sidebar-tickers.json'
);
const sidebarTickers = JSON.parse(fs.readFileSync(sidebarTickersPath, 'utf8'));

// ISIN -> 올바른 symbol 매핑 생성
const isinToSymbolMap = new Map();
sidebarTickers.forEach((ticker) => {
    if (ticker.isin && ticker.symbol) {
        isinToSymbolMap.set(ticker.isin, ticker.symbol);
    }
});

console.log(`📊 총 ${isinToSymbolMap.size}개의 ISIN-Symbol 매핑 로드됨`);

/**
 * 모든 사용자의 자산에서 잘못된 symbol을 찾아 수정
 */
async function fixAssetSymbols(dryRun = true) {
    console.log('\n🔍 자산 Symbol 마이그레이션 시작...');
    console.log(
        `모드: ${dryRun ? '🔍 DRY RUN (실제 변경 없음)' : '✏️ WRITE MODE (실제 변경)'}\n`
    );

    let totalUsers = 0;
    let totalAssets = 0;
    let fixedAssets = 0;
    let errorAssets = 0;

    const fixes = [];

    try {
        // 모든 사용자 순회
        console.log('📡 Firestore에서 userAssets 컬렉션 조회 중...');

        // 먼저 모든 컬렉션 목록 확인
        try {
            const collections = await db.listCollections();
            console.log('📋 사용 가능한 컬렉션 목록:');
            collections.forEach((col) => {
                console.log(`   - ${col.id}`);
            });
            console.log('');
        } catch (listError) {
            console.log('⚠️  컬렉션 목록 조회 실패:', listError.message);
        }

        // listDocuments()를 사용하여 문서 참조 가져오기
        console.log('🔬 listDocuments()로 문서 참조 가져오기...');
        const userDocRefs = await db.collection('userAssets').listDocuments();
        console.log(`📄 발견된 문서 참조: ${userDocRefs.length}개`);

        if (userDocRefs.length === 0) {
            console.log('\n⚠️  userAssets 컬렉션에 문서가 없습니다.');
            return;
        }

        // 각 문서 참조에서 실제 데이터 가져오기
        for (const userDocRef of userDocRefs) {
            const userId = userDocRef.id;
            console.log(`\n📂 사용자: ${userId}`);
            totalUsers++;

            // 해당 사용자의 모든 자산 조회
            const assetsSnapshot = await db
                .collection('userAssets')
                .doc(userId)
                .collection('assets')
                .get();

            console.log(`   자산 개수: ${assetsSnapshot.size}`);

            for (const assetDoc of assetsSnapshot.docs) {
                totalAssets++;
                const assetId = assetDoc.id;
                const assetData = assetDoc.data();

                // 주식 타입만 처리
                if (assetData.type !== '주식') {
                    continue;
                }

                const currentIsin = assetData.isin || assetId;
                const currentSymbol = assetData.symbol;

                // ISIN이 없으면 스킵
                if (
                    !currentIsin ||
                    currentIsin.startsWith('STOCK_') ||
                    currentIsin.startsWith('CASH_') ||
                    currentIsin.startsWith('COIN_')
                ) {
                    console.log(
                        `   ⚠️  [${assetId}] ISIN 없음 또는 특수 형식, 스킵`
                    );
                    errorAssets++;
                    continue;
                }

                // 올바른 symbol 찾기
                const correctSymbol = isinToSymbolMap.get(currentIsin);

                if (!correctSymbol) {
                    console.log(
                        `   ⚠️  [${assetId}] ISIN ${currentIsin}에 대한 매핑 없음`
                    );
                    errorAssets++;
                    continue;
                }

                // symbol이 다른 경우 수정 필요
                if (currentSymbol !== correctSymbol) {
                    console.log(`   🔧 [${assetId}] Symbol 수정 필요:`);
                    console.log(`      현재: ${currentSymbol || '(없음)'}`);
                    console.log(`      수정: ${correctSymbol}`);
                    console.log(`      ISIN: ${currentIsin}`);

                    fixes.push({
                        userId,
                        assetId,
                        isin: currentIsin,
                        oldSymbol: currentSymbol,
                        newSymbol: correctSymbol,
                        name: assetData.name,
                    });

                    if (!dryRun) {
                        try {
                            await db
                                .collection('userAssets')
                                .doc(userId)
                                .collection('assets')
                                .doc(assetId)
                                .update({
                                    symbol: correctSymbol,
                                    updatedAt: new Date(),
                                });
                            console.log(`      ✅ 수정 완료`);
                            fixedAssets++;
                        } catch (error) {
                            console.error(`      ❌ 수정 실패:`, error.message);
                            errorAssets++;
                        }
                    } else {
                        fixedAssets++;
                    }
                }
            }
        }

        // 결과 요약
        console.log('\n' + '='.repeat(60));
        console.log('📊 마이그레이션 결과 요약');
        console.log('='.repeat(60));
        console.log(`총 사용자 수: ${totalUsers}`);
        console.log(`총 자산 수: ${totalAssets}`);
        console.log(`수정된 자산: ${fixedAssets}`);
        console.log(`오류/스킵: ${errorAssets}`);
        console.log('='.repeat(60));

        if (fixes.length > 0) {
            console.log('\n📝 수정 내역:');
            fixes.forEach((fix, index) => {
                console.log(`\n${index + 1}. ${fix.name || fix.isin}`);
                console.log(`   사용자: ${fix.userId}`);
                console.log(`   ISIN: ${fix.isin}`);
                console.log(
                    `   ${fix.oldSymbol || '(없음)'} → ${fix.newSymbol}`
                );
            });
        }

        if (dryRun) {
            console.log('\n💡 실제로 변경하려면 --write 옵션을 사용하세요:');
            console.log(
                '   node scripts/migration/fix-asset-symbols.js --write'
            );
        }
    } catch (error) {
        console.error('❌ 마이그레이션 중 오류 발생:', error);
        console.error('상세 오류:', error.stack);
        throw error;
    }
}

// 스크립트 실행
const args = process.argv.slice(2);
const dryRun = !args.includes('--write');

fixAssetSymbols(dryRun)
    .then(() => {
        console.log('\n✅ 마이그레이션 완료');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ 마이그레이션 실패:', error);
        process.exit(1);
    });
