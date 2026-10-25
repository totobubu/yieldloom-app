import admin from 'firebase-admin';
import { createApiHandler } from '../lib/api-handler.js';
import { capitalHandler } from '../lib/portfolio-capital-handler.js';
import { portfolioDashboardHandler } from '../lib/portfolio-dashboard-handler.js';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import {
    firebaseDatabase,
    verifyFirebaseBearer,
} from './_utils/firebase-auth.js';

const verify = (req) => verifyFirebaseBearer(req, true);
const dashboard = portfolioDashboardHandler({
    verify,
    database: () => admin.firestore(),
    documentId: admin.firestore.FieldPath.documentId(),
});
const capital = capitalHandler({
    verify,
    database: () => admin.firestore(),
    timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    onReadUsage: (usage) => console.info(JSON.stringify(usage)),
});
const sheetLedger = sheetLedgerHandler({
    verify: verifyFirebaseBearer,
    database: firebaseDatabase,
});

export default createApiHandler((req, res) => {
    if (req.query?.view === 'sheet-ledger') return sheetLedger(req, res);
    if (req.query?.view === 'dashboard') return dashboard(req, res);
    return capital(req, res);
});
