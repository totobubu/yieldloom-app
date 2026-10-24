import { createApiHandler } from '../lib/api-handler.js';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import {
    firebaseDatabase,
    verifyFirebaseBearer,
} from './_utils/firebase-auth.js';

export default createApiHandler(
    sheetLedgerHandler({
        verify: verifyFirebaseBearer,
        database: firebaseDatabase,
    })
);
