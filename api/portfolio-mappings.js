import admin from 'firebase-admin';
import catalog from '../data-v2/catalog-seed.json' with { type: 'json' };
import { createApiHandler } from '../lib/api-handler.js';
import { mappingHandler } from '../lib/portfolio-mappings.js';
import { verifyFirebaseBearer } from './_utils/firebase-auth.js';

export default createApiHandler(
    mappingHandler({
        verify: verifyFirebaseBearer,
        database: () => admin.firestore(),
        catalog: catalog.instruments,
        timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
);
