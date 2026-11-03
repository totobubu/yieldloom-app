import { watch } from 'vue';
import { firebaseUser } from './firebaseClient.js';
import { createAccountTossClient } from './accountTossClient.js';
import { createLocalTossClient } from './localTossClient.js';
export const accountToss = createAccountTossClient({
    getUser: () => firebaseUser.value,
});
export const localToss = createLocalTossClient({
    cloudClient: accountToss,
    getUser: () => firebaseUser.value,
});
watch(
    firebaseUser,
    () => {
        accountToss.clear();
        localToss.clear();
    },
    { flush: 'sync' }
);
