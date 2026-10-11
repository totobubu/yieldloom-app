#!/usr/bin/env node
/** Copies the verified legacy admin snapshot into the canonical portfolios tree. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import admin from 'firebase-admin';

const root = process.cwd();
const apply = process.argv.includes('--apply');
const uid = process.argv[process.argv.indexOf('--uid') + 1] || 'zxVEBwc4mcMAhwLCEkXxtcpyjPx1';
for (const file of ['.env.local', '.env.development']) {
  const filename = join(root, file);
  if (!existsSync(filename)) continue;
  const text = readFileSync(filename, 'utf8');
  const start = text.indexOf('FIRESTORE_SA_KEY=');
  if (start >= 0 && !process.env.FIRESTORE_SA_KEY) {
    const value = text.slice(start + 'FIRESTORE_SA_KEY='.length);
    const end = value.indexOf('\nTOSS_');
    process.env.FIRESTORE_SA_KEY = (end >= 0 ? value.slice(0, end) : value).trim();
  }
}
if (!process.env.FIRESTORE_SA_KEY) throw new Error('FIRESTORE_SA_KEY is required');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIRESTORE_SA_KEY)) });
const db = admin.firestore();
const source = db.collection('adminPortfolios').doc(uid);
const target = db.collection('portfolios').doc(uid);
const rootSnapshot = await source.get();
const assets = await source.collection('assets').get();
if (!rootSnapshot.exists && assets.empty) throw new Error('Legacy admin portfolio does not exist');
const records = [{ ref: target, data: { ...(rootSnapshot.data() || {}), ownerUid: uid, migratedFrom: 'adminPortfolios', migratedAt: admin.firestore.FieldValue.serverTimestamp() } }];
for (const asset of assets.docs) {
  const targetAsset = target.collection('assets').doc(asset.id);
  records.push({ ref: targetAsset, data: asset.data() });
  const transactions = await asset.ref.collection('transactions').get();
  for (const transaction of transactions.docs) records.push({ ref: targetAsset.collection('transactions').doc(transaction.id), data: transaction.data() });
}
if (!apply) {
  console.log(JSON.stringify({ mode: 'preview', uid, assetCount: assets.size, documentCount: records.length }));
} else {
  for (let index = 0; index < records.length; index += 450) {
    const batch = db.batch();
    for (const record of records.slice(index, index + 450)) batch.set(record.ref, record.data, { merge: true });
    await batch.commit();
  }
  console.log(JSON.stringify({ mode: 'applied', uid, assetCount: assets.size, documentCount: records.length }));
}
