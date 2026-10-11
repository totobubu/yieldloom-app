import { ref } from 'vue';
import { auth, signOut } from '../firebase';
import router from '../router';
import { onAuthStateChanged } from 'firebase/auth';

// Retained for the separately preserved Toss recovery tool.
export const user = ref(null);
export const isRecentlyAuthenticated = ref(false);
export const handleSignOut = async () => {
    await signOut(auth);
    await router.push({ name: 'thumbnail-home' });
};
onAuthStateChanged(auth, firebaseUser => {
    user.value = firebaseUser ? {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
    } : null;
    if (!firebaseUser) isRecentlyAuthenticated.value = false;
});
