import admin from 'firebase-admin';
import { createApiHandler } from '../lib/api-handler.js';
import { portfolioDashboardHandler } from '../lib/portfolio-dashboard-handler.js';
import {
    firebaseDatabase,
    verifyFirebaseBearer,
} from './_utils/firebase-auth.js';

export default createApiHandler(
    portfolioDashboardHandler({
        verify: (req) => verifyFirebaseBearer(req, true),
        database: firebaseDatabase,
        documentId: admin.firestore.FieldPath.documentId(),
    })
);
