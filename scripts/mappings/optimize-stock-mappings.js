// scripts/optimize-stock-mappings.js
/**
 * Optimization Script: stockMappings Field Structure
 *
 * Changes:
 * 1. Remove: brokerage, createdAt, createdBy, stockInfo.name
 * 2. Move: stockInfo.exchange → market (top-level)
 * 3. Add: enName, yfSymbol, ipoDate, currency, company
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
    readFileSync('./serviceAccountKey.json', 'utf8')
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function optimizeStockMappings() {
    console.log('🚀 Starting stockMappings optimization...\n');

    try {
        // Step 1: Read all existing documents
        const snapshot = await db.collection('stockMappings').get();
        console.log(`📊 Found ${snapshot.size} documents to optimize\n`);

        if (snapshot.empty) {
            console.log('✅ No documents to optimize');
            return;
        }

        const batch = db.batch();
        let count = 0;

        // Step 2: Process each document
        for (const doc of snapshot.docs) {
            const oldData = doc.data();
            const isin = doc.id;

            // Create optimized document structure
            const newData = {
                koName: oldData.koName,
                isin: oldData.isin,
                symbol: oldData.symbol,
                // Move exchange to market
                market: oldData.stockInfo?.exchange || oldData.market || null,
                // Add new fields (will be null initially, can be populated later)
                enName: oldData.stockInfo?.enName || null,
                yfSymbol: oldData.stockInfo?.yfSymbol || oldData.symbol || null,
                ipoDate: oldData.stockInfo?.ipoDate || null,
                currency: oldData.stockInfo?.currency || null,
                company: oldData.stockInfo?.company || null,
                // Keep minimal stockInfo for any additional data
                stockInfo: {},
            };

            // Remove null values to keep documents clean
            Object.keys(newData).forEach((key) => {
                if (newData[key] === null) {
                    delete newData[key];
                }
            });

            // Update document
            batch.set(doc.ref, newData);
            count++;

            console.log(`✓ Optimizing: ${isin} (${newData.koName})`);
        }

        // Step 3: Commit changes
        if (count > 0) {
            console.log(`\n📝 Committing ${count} optimized documents...`);
            await batch.commit();
            console.log('✅ Documents optimized successfully\n');
        }

        // Step 4: Summary
        console.log('📊 Optimization Summary:');
        console.log(`   ✅ Optimized: ${count}`);
        console.log('\n✅ Optimization completed successfully!');
    } catch (error) {
        console.error('❌ Optimization failed:', error);
        throw error;
    } finally {
        // Cleanup
        await admin.app().delete();
    }
}

// Run optimization
optimizeStockMappings()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
