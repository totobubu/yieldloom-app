import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

// Import path mapping
const importMappings = {
  // Asset
  '@/composables/useAssetFirestore': '@/composables/asset/useAssetFirestore',
  '@/composables/useAssetAdmin': '@/composables/asset/useAssetAdmin',
  '@/composables/useAdmin': '@/composables/asset/useAdmin',

  // Portfolio
  '@/composables/useFilterState': '@/composables/portfolio/useFilterState',
  '@/composables/useBacktestPortfolio': '@/composables/portfolio/useBacktestPortfolio',
  '@/composables/useSidebar': '@/composables/portfolio/useSidebar',

  // Data
  '@/composables/useStockData': '@/composables/data/useStockData',
  '@/composables/useLocalStockData': '@/composables/data/useLocalStockData',
  '@/composables/useCalendarData': '@/composables/data/useCalendarData',
  '@/composables/useDividendStats': '@/composables/data/useDividendStats',
  '@/composables/useBacktestData': '@/composables/data/useBacktestData',
  '@/composables/useExchangeRates': '@/composables/data/useExchangeRates',
  '@/composables/useStockMapping': '@/composables/data/useStockMapping',

  // Shared
  '@/composables/useBreakpoint': '@/composables/shared/useBreakpoint',
  '@/composables/useLayout': '@/composables/shared/useLayout',
  '@/composables/useStockCharts': '@/composables/shared/useStockCharts',
};

// Recursively find all .vue and .js files
function findFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      if (!filePath.includes('node_modules') && !filePath.includes('dist')) {
        findFiles(filePath, fileList);
      }
    } else if (file.endsWith('.vue') || file.endsWith('.js')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

const files = findFiles('src');

let updatedCount = 0;

files.forEach(file => {
  let content = readFileSync(file, 'utf8');
  let modified = false;

  Object.entries(importMappings).forEach(([oldPath, newPath]) => {
    // Match both single and double quotes
    const regex1 = new RegExp(`from ['"]${oldPath.replace(/\//g, '\\/')}['"]`, 'g');
    const regex2 = new RegExp(`import\\(['"]${oldPath.replace(/\//g, '\\/')}['"]\\)`, 'g');

    if (regex1.test(content) || regex2.test(content)) {
      content = content.replace(regex1, `from '${newPath}'`);
      content = content.replace(regex2, `import('${newPath}')`);
      modified = true;
    }
  });

  if (modified) {
    writeFileSync(file, content, 'utf8');
    updatedCount++;
    console.log(`✓ Updated: ${file}`);
  }
});

console.log(`\n✅ Updated ${updatedCount} files`);
