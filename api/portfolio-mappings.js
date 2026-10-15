import admin from 'firebase-admin';
import nav from '../public/nav.json' with { type: 'json' };
import { createApiHandler } from '../lib/api-handler.js';
import { mappingHandler } from '../lib/portfolio-mappings.js';
import { verifyFirebaseBearer } from './_utils/firebase-auth.js';

export default createApiHandler(
    mappingHandler({
        verify: verifyFirebaseBearer,
        database: () => admin.firestore(),
        catalog: nav.nav,
        timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
);
