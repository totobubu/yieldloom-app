// scripts/utils/fix_zero_price_data.js
// 잘못된 0 값 데이터를 null로 수정하는 유틸리티

import fs from 'fs/promises';
import path from 'path';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');

const KR_MARKETS = ['kospi', 'kosdaq', 'konex'];

async function fixZeroPriceData(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        if (!data.backtestData || !Array.isArray(data.backtestData)) {
            return { fixed: false, reason: 'No backtestData array' };
        }
        
        let fixedCount = 0;
        let hasChanges = false;
        
        data.backtestData = data.backtestData.map((item) => {
            const original = { ...item };
            let changed = false;
            
            // open, high, low, volume이 0이고 close가 있는 경우 null로 변경
            if (item.close != null && item.close !== 0) {
                if (item.open === 0) {
                    item.open = null;
                    changed = true;
                }
                if (item.high === 0) {
                    item.high = null;
                    changed = true;
                }
                if (item.low === 0) {
                    item.low = null;
                    changed = true;
                }
                if (item.volume === 0) {
                    item.volume = null;
                    changed = true;
                }
            }
            
            if (changed) {
                fixedCount++;
                hasChanges = true;
            }
            
            return item;
        });
        
        if (hasChanges) {
            await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
            return { fixed: true, count: fixedCount };
        }
        
        return { fixed: false, reason: 'No zero values found' };
    } catch (error) {
        return { fixed: false, error: error.message };
    }
}

async function scanAndFix(dryRun = false) {
    console.log('--- Scanning for zero price data issues ---');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'FIX MODE (will modify files)'}`);
    console.log('');
    
    let totalFiles = 0;
    let fixedFiles = 0;
    let errorFiles = 0;
    const problemDates = new Set();
    
    for (const market of KR_MARKETS) {
        const marketDir = path.join(DATA_DIR, market);
        try {
            const files = await fs.readdir(marketDir);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            
            console.log(`\n[${market.toUpperCase()}] Scanning ${jsonFiles.length} files...`);
            
            for (const file of jsonFiles) {
                totalFiles++;
                const filePath = path.join(marketDir, file);
                
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    
                    if (!data.backtestData || !Array.isArray(data.backtestData)) {
                        continue;
                    }
                    
                    // 0 값이 있는 항목 찾기
                    const zeroItems = data.backtestData.filter(item => 
                        item.close != null && item.close !== 0 &&
                        (item.open === 0 || item.high === 0 || item.low === 0 || item.volume === 0)
                    );
                    
                    if (zeroItems.length > 0) {
                        zeroItems.forEach(item => problemDates.add(item.date));
                        
                        if (!dryRun) {
                            const result = await fixZeroPriceData(filePath);
                            if (result.fixed) {
                                fixedFiles++;
                                console.log(`  ✅ Fixed ${file}: ${result.count} entries`);
                            }
                        } else {
                            console.log(`  ⚠️  Found ${file}: ${zeroItems.length} entries with zero values`);
                            zeroItems.slice(0, 3).forEach(item => {
                                console.log(`     - ${item.date}: open=${item.open}, high=${item.high}, low=${item.low}, volume=${item.volume}`);
                            });
                        }
                    }
                } catch (error) {
                    errorFiles++;
                    console.error(`  ❌ Error processing ${file}: ${error.message}`);
                }
            }
        } catch (error) {
            console.error(`Error accessing ${marketDir}: ${error.message}`);
        }
    }
    
    console.log('\n--- Summary ---');
    console.log(`Total files scanned: ${totalFiles}`);
    if (dryRun) {
        console.log(`Files with zero values: ${fixedFiles}`);
    } else {
        console.log(`Files fixed: ${fixedFiles}`);
    }
    console.log(`Files with errors: ${errorFiles}`);
    console.log(`Problem dates found: ${Array.from(problemDates).sort().join(', ')}`);
}

// 커맨드라인 인자 파싱
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');

scanAndFix(dryRun).catch(console.error);

