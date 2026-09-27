import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'public', 'data');
const desiredOrder = ['tickerInfo', 'dividendTotal', 'backtestData'];

function sortKeysPreservingOthers(originalObject) {
  if (!originalObject || typeof originalObject !== 'object' || Array.isArray(originalObject)) {
    return originalObject;
  }

  // keep original key order for the rest
  const originalKeys = Object.keys(originalObject);
  const remainingKeys = originalKeys.filter((k) => !desiredOrder.includes(k));

  const sorted = {};

  for (const key of desiredOrder) {
    if (Object.prototype.hasOwnProperty.call(originalObject, key)) {
      sorted[key] = originalObject[key];
    }
  }

  for (const key of remainingKeys) {
    sorted[key] = originalObject[key];
  }

  return sorted;
}

function processFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse JSON: ${filePath}`);
    throw e;
  }

  const sorted = sortKeysPreservingOthers(json);
  const output = JSON.stringify(sorted, null, 2) + '\n';
  fs.writeFileSync(filePath, output, 'utf8');
}

function main() {
  if (!fs.existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(dataDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((ent) => ent.isFile() && ent.name.toLowerCase().endsWith('.json'))
    .map((ent) => path.join(dataDir, ent.name));

  if (jsonFiles.length === 0) {
    console.log('No JSON files found in public/data.');
    return;
  }

  let updated = 0;
  let failed = 0;
  for (const file of jsonFiles) {
    try {
      processFile(file);
      updated += 1;
    } catch (e) {
      failed += 1;
      console.error(`Skipped due to error: ${file}`);
    }
  }

  console.log(`Sorted key order for ${updated} file(s) in public/data. Failures: ${failed}.`);
}

main();


