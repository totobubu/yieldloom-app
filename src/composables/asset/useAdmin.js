// src/composables/useAdmin.js
import { computed } from 'vue';
import { user } from '@/store/auth';
import { isAdminEmail } from '@/config/admin';

export const useAdmin = () => {
    const isAdmin = computed(() => {
        const email = user.value?.email ?? '';
        return isAdminEmail(email);
    });

    return {
        isAdmin,
    };
};
