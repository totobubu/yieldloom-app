import { firebaseUser } from './firebaseClient';
import { createFamilyPortfolioClient } from './familyPortfolioClient.js';
import { createPortfolioLedgerClient } from './portfolioLedgerClient.js';
import { watch } from 'vue';
import { createPortfolioPreferencesClient } from './portfolioPreferencesClient.js';

export const familyRequest = createFamilyPortfolioClient({
    getUser: () => firebaseUser.value,
});

export const loadFamilyLedger = createPortfolioLedgerClient({
    getUser: () => firebaseUser.value,
    request: familyRequest,
});
export const portfolioPreferences = createPortfolioPreferencesClient({
    getUser: () => firebaseUser.value,
    request: familyRequest,
});

// Also clear during logout/login without an intervening API request.
watch(
    firebaseUser,
    () => {
        familyRequest.clear();
        loadFamilyLedger.clear();
        portfolioPreferences.clear();
    },
    { flush: 'sync' }
);
