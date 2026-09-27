// scripts/mappings/sync-nav-to-firebase.js
/**
 * Sync Script: nav.json → Firebase stockMappings
 *
 * nav.json의 데이터를 Firebase stockMappings 컬렉션에 동기화합니다.
 *
 * Usage:
 *   node scripts/mappings/sync-nav-to-firebase.js                    # 전체 동기화
 *   node scripts/mappings/sync-nav-to-firebase.js --symbol VOO       # VOO만 동기화
 *   node scripts/mappings/sync-nav-to-firebase.js --symbol VOO --symbol QQQ  # 여러 종목
 *
 * 매핑되는 필드:
 * - symbol → symbol
 * - koName → koName
 * - longName → longName
 * - isin → isin (문서 ID로도 사용)
 * - market → market
 * - currency → currency
 * - company → company
 * - yfSymbol → yfSymbol
 * - ipoDate → ipoDate
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Parse command line arguments
const args = process.argv.slice(2);
const symbolsToSync = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) {
        symbolsToSync.push(args[i + 1].toUpperCase());
        i++; // Skip next argument
    }
}

// Initialize Firebase Admin
let serviceAccount;
if (process.env.FIRESTORE_SA_KEY) {
    // GitHub Actions or other CI environment
    serviceAccount = JSON.parse(process.env.FIRESTORE_SA_KEY);
} else {
    // Local development
    serviceAccount = JSON.parse(
        readFileSync('./serviceAccountKey.json', 'utf8')
    );
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function syncNavToFirebase() {
    const isSingleSync = symbolsToSync.length > 0;

    console.log('🚀 Starting nav.json → Firebase sync...\n');

    if (isSingleSync) {
        console.log(
            `🎯 Syncing specific symbols: ${symbolsToSync.join(', ')}\n`
        );
    }

    try {
        // Step 1: Read nav.json
        console.log('📖 Reading nav.json...');
        const navData = JSON.parse(readFileSync('./public/nav.json', 'utf8'));

        if (!navData.nav || !Array.isArray(navData.nav)) {
            throw new Error('Invalid nav.json structure');
        }

        console.log(`📊 Found ${navData.nav.length} items in nav.json\n`);

        // Step 2: Filter items
        let itemsToSync = navData.nav.filter((item) => item.isin);

        // Filter by symbols if specified
        if (isSingleSync) {
            itemsToSync = itemsToSync.filter((item) =>
                symbolsToSync.includes(item.symbol?.toUpperCase())
            );

            if (itemsToSync.length === 0) {
                console.log('⚠️  No matching symbols found in nav.json');
                return;
            }

            console.log(`✓ Found ${itemsToSync.length} matching items\n`);
        } else {
            console.log(`✓ ${itemsToSync.length} items have ISIN\n`);
        }

        // Step 3: Process in batches
        const batchSize = 500; // Firestore batch limit
        let totalProcessed = 0;
        let totalUpdated = 0;
        let totalSkipped = 0;

        for (let i = 0; i < itemsToSync.length; i += batchSize) {
            const batch = db.batch();
            const chunk = itemsToSync.slice(i, i + batchSize);

            for (const item of chunk) {
                const isin = item.isin;

                // Skip if no ISIN
                if (!isin) {
                    totalSkipped++;
                    continue;
                }

                const docRef = db.collection('stockMappings').doc(isin);

                // Prepare data (no stockInfo)
                const data = {
                    isin: isin,
                    symbol: item.symbol || null,
                    koName: item.koName || null,
                    longName: item.longName || null,
                    enName: item.englishName || null,
                    market: item.market || null,
                    currency: item.currency || null,
                    company: item.company || null,
                    yfSymbol: item.yfSymbol || item.symbol || null,
                    ipoDate: item.ipoDate || null,
                };

                // Remove null values
                Object.keys(data).forEach((key) => {
                    if (data[key] === null) {
                        delete data[key];
                    }
                });

                // Merge with existing data
                batch.set(docRef, data, { merge: true });
                totalUpdated++;

                if (isSingleSync) {
                    console.log(
                        `  ✓ ${item.symbol} (${item.koName || item.longName})`
                    );
                }
            }

            // Commit batch
            await batch.commit();
            totalProcessed += chunk.length;

            if (!isSingleSync) {
                console.log(
                    `✓ Processed ${totalProcessed}/${itemsToSync.length} items...`
                );
            }
        }

        // Step 4: Summary
        console.log('\n📊 Sync Summary:');
        if (isSingleSync) {
            console.log(`   🎯 Symbols requested: ${symbolsToSync.join(', ')}`);
            console.log(`   ✅ Items found: ${itemsToSync.length}`);
        } else {
            console.log(`   ✅ Total items in nav.json: ${navData.nav.length}`);
            console.log(`   ✅ Items with ISIN: ${itemsToSync.length}`);
        }
        console.log(`   ✅ Updated in Firebase: ${totalUpdated}`);
        console.log(`   ⚠️  Skipped (no ISIN): ${totalSkipped}`);
        console.log('\n✅ Sync completed successfully!');
    } catch (error) {
        console.error('❌ Sync failed:', error);
        throw error;
    } finally {
        // Cleanup
        await admin.app().delete();
    }
}

// Run sync
syncNavToFirebase()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
