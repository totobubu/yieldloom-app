import catalog from '../data-v2/catalog-seed.json' with { type: 'json' };
import { createApiHandler } from '../lib/api-handler.js';
import { stockCollectionHandler } from '../lib/stock-collection.js';
import { verifyFirebaseBearer } from './_utils/firebase-auth.js';
const symbols = new Set(catalog.instruments.map((row) => row.symbol));
export default createApiHandler(
    stockCollectionHandler({
        verify: verifyFirebaseBearer,
        knownSymbol: (symbol) => symbols.has(symbol),
    }),
    { publicCors: true }
);
