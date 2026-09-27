// src/composables/asset/useAdmin.ts
import { computed, type ComputedRef } from 'vue';
import { user } from '@/store/auth';
import { isAdminEmail } from '@/config/admin';

export interface UseAdminReturn {
    isAdmin: ComputedRef<boolean>;
}

export const useAdmin = (): UseAdminReturn => {
    const isAdmin = computed(() => {
        const currentUser = user.value as { email?: string } | null;
        const email = currentUser?.email ?? '';
        return isAdminEmail(email);
    });

    return {
        isAdmin,
    };
};
