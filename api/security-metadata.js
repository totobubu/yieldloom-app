import registry from '../data-v2/security-underlyings.json' with { type: 'json' };
import audit from '../docs/data-management/underlying-audit.json' with { type: 'json' };
import health from '../data-v2/collection-health.json' with { type: 'json' };
import catalog from '../data-v2/catalog-seed.json' with { type: 'json' };
import { createApiHandler } from '../lib/api-handler.js';
import {
    reviewDataset,
    metadataReviewHandler,
} from '../lib/metadata/reviews.js';
import {
    verifyFirebaseBearer,
    firebaseDatabase,
} from './_utils/firebase-auth.js';
export default createApiHandler(
    metadataReviewHandler({
        verify: verifyFirebaseBearer,
        database: firebaseDatabase,
        dataset: reviewDataset(registry, audit, catalog.instruments, health),
    }),
    { publicCors: true }
);
