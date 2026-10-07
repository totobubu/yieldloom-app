import { ref } from 'vue';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '@/firebase';

const entriesPath = (userId) => `userAssets/${userId}/recoveryLedger`;

export function useRecoveryLedger() {
    const isLoading = ref(false);

    const loadEntries = async (userId) => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const snapshot = await getDocs(collection(db, entriesPath(userId)));
            return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        } finally {
            isLoading.value = false;
        }
    };

    const saveReviewedEntries = async (userId, entries) => {
        const existing = await loadEntries(userId);
        const fingerprints = new Set(existing.map((entry) => entry.fingerprint));
        const accepted = entries.filter((entry) => {
            if (entry.reviewStatus !== 'approved' || fingerprints.has(entry.fingerprint)) {
                return false;
            }
            fingerprints.add(entry.fingerprint);
            return true;
        });
        // Firestore batches are limited to 500 writes. A statement archive can
        // exceed that, so preserve all-or-nothing per bounded chunk.
        for (let index = 0; index < accepted.length; index += 450) {
            const batch = writeBatch(db);
            accepted.slice(index, index + 450).forEach((entry) => {
                const reference = doc(collection(db, entriesPath(userId)));
                batch.set(reference, {
                    ...entry,
                    reviewStatus: 'applied',
                    appliedAt: new Date(),
                });
            });
            await batch.commit();
        }
        return { inserted: accepted.length, duplicates: entries.length - accepted.length };
    };

    return { isLoading, loadEntries, saveReviewedEntries };
}
