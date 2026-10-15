import admin from 'firebase-admin';
import { createApiHandler } from '../lib/api-handler.js';
import { capitalHandler } from '../lib/portfolio-capital-handler.js';
import { verifyFirebaseBearer } from './_utils/firebase-auth.js';

export default createApiHandler(
    capitalHandler({
        verify: verifyFirebaseBearer,
        database: () => admin.firestore(),
        timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
);
