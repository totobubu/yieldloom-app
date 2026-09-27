import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin SDK
let serviceAccountPath;
const possiblePaths = [
    path.join(__dirname, '../service-account-key.json'),
    path.join(__dirname, '../serviceAccountKey.json'),
];

for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
        serviceAccountPath = p;
        break;
    }
}

if (!serviceAccountPath) {
    console.error('❌ Error: Service account key not found.');
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

console.log(`✅ Using: ${path.basename(serviceAccountPath)}\n`);

const db = admin.firestore();
const navDir = path.join(__dirname, '../public/nav');

async function extractMissingSymbols() {
    try {
        console.log('📥 Fetching from Firebase...');

        const mappingsSnapshot = await db.collection('stockMappings').get();
        const firebaseMappings = [];

        mappingsSnapshot.forEach((doc) => {
            const data = doc.data();
            firebaseMappings.push({
                symbol: data.systemTicker,
                isin: data.brokerageTicker,
                koName: data.stockInfo?.name,
            });
        });

        console.log(`Found ${firebaseMappings.length} mappings in Firebase.`);

        console.log('\n📂 Scanning public/nav files...');
        console.log(`Directory: ${navDir}`);
        console.log(`Exists: ${fs.existsSync(navDir)}`);

        const navSymbols = new Set();

        const markets = fs
            .readdirSync(navDir)
            .filter((file) =>
                fs.statSync(path.join(navDir, file)).isDirectory()
            );

        console.log(`Markets: ${markets.join(', ')}`);

        for (const market of markets) {
            const marketDir = path.join(navDir, market);
            const files = fs
                .readdirSync(marketDir)
                .filter((f) => f.endsWith('.json'));

            console.log(`  ${market}: ${files.length} files`);

            for (const file of files) {
                const filePath = path.join(marketDir, file);
                const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                console.log(`    ${file}: ${content.length} stocks`);

                content.forEach((stock) => {
                    if (stock.symbol) {
                        navSymbols.add(stock.symbol);
                    }
                });
            }
        }

        console.log(`\nTotal: ${navSymbols.size} symbols in nav`);

        const missingSymbols = firebaseMappings.filter(
            (m) => !navSymbols.has(m.symbol)
        );

        console.log(`\nMissing: ${missingSymbols.length} symbols`);

        if (missingSymbols.length > 0) {
            const outputPath = path.join(__dirname, '../missing_symbols.json');
            fs.writeFileSync(
                outputPath,
                JSON.stringify(missingSymbols, null, 4),
                'utf8'
            );
            console.log(`\n✅ Exported to: ${outputPath}`);

            missingSymbols.forEach((item, i) => {
                console.log(
                    `${i + 1}. ${item.symbol} - ${item.koName} (${item.isin})`
                );
            });
        } else {
            console.log('\n✅ All symbols exist in nav files.');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

extractMissingSymbols();
