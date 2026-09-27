import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mappingsPath = process.argv[2];

if (!mappingsPath) {
    console.error('Usage: node scripts/mappings/update_mappings.js <path-to-mappings.json>');
    process.exit(1);
}

const mappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
const publicNavPath = path.join(__dirname, '../../public/nav');

let updatedCount = 0;
let errors = 0;

// Helper to find the correct file path
const getFilePath = (market, symbol) => {
    const firstChar = symbol.charAt(0).toLowerCase();
    // Handle numeric or special chars if needed, but assuming standard 0-9, a-z structure
    // If firstChar is a number, it's fine.
    return path.join(publicNavPath, market, `${firstChar}.json`);
};

// Group mappings by file to minimize file I/O
const updatesByFile = new Map();
const allMarkets = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'];

// Helper to find existing symbol across all markets
const findExistingSymbol = (symbol) => {
    for (const market of allMarkets) {
        const filePath = getFilePath(market, symbol);
        if (fs.existsSync(filePath)) {
            try {
                const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const entry = content.find(item => item.symbol === symbol);
                if (entry) {
                    return { market, filePath, entry };
                }
            } catch (error) {
                // Continue searching
            }
        }
    }
    return null;
};

mappings.forEach(mapping => {
    const symbol = mapping.systemTicker;

    // First, try to find if symbol already exists in any market
    const existing = findExistingSymbol(symbol);

    let filePath;
    if (existing) {
        // Use the existing market
        filePath = existing.filePath;
    } else {
        // Use the market from mapping, or default to NASDAQ
        const market = mapping.stockInfo?.market || 'NASDAQ';
        filePath = getFilePath(market, symbol);
    }

    if (!updatesByFile.has(filePath)) {
        updatesByFile.set(filePath, []);
    }
    updatesByFile.get(filePath).push(mapping);
});

// Process each file
updatesByFile.forEach((fileMappings, filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            console.warn(`File not found: ${filePath}. Skipping ${fileMappings.length} mappings.`);
            return;
        }

        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        let fileModified = false;

        fileMappings.forEach(mapping => {
            const symbol = mapping.systemTicker;
            const koName = mapping.brokerageStockName;
            const isin = mapping.brokerageTicker;

            // Find entry
            let entry = content.find(item => item.symbol === symbol);

            if (entry) {
                // Update existing
                let modified = false;
                if (entry.koName !== koName) {
                    entry.koName = koName;
                    modified = true;
                }
                if (isin && entry.isin !== isin) {
                    entry.isin = isin;
                    modified = true;
                }

                if (modified) {
                    fileModified = true;
                    updatedCount++;
                    console.log(`Updated ${symbol} in ${path.basename(filePath)}`);
                }
            } else {
                // Add new entry? User said "add to our system".
                // We need to construct a new entry.
                // We might lack some fields like 'frequency', 'ipoDate' etc.
                // But we can add what we have.
                const newEntry = {
                    symbol: symbol,
                    koName: koName,
                    isin: isin,
                    market: mapping.stockInfo?.market || 'NASDAQ', // Ensure market is set
                    currency: mapping.stockInfo?.currency || 'USD', // Default currency?
                    // Add other fields if available in stockInfo
                    ...mapping.stockInfo
                };

                // Clean up stockInfo nesting if it was spread
                delete newEntry.market; // Re-add below to ensure order or correctness if needed
                newEntry.market = mapping.stockInfo?.market || 'NASDAQ';

                content.push(newEntry);
                // Sort by symbol to maintain order?
                content.sort((a, b) => a.symbol.localeCompare(b.symbol));

                fileModified = true;
                updatedCount++;
                console.log(`Added ${symbol} to ${path.basename(filePath)}`);
            }
        });

        if (fileModified) {
            fs.writeFileSync(filePath, JSON.stringify(content, null, 4));
        }
    } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
        errors++;
    }
});

console.log(`Done. Updated/Added ${updatedCount} items. Errors: ${errors}`);
