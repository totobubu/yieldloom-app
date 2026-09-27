// src/composables/shared/useBreakpoint.ts
import {
    ref,
    computed,
    onMounted,
    onBeforeUnmount,
    readonly,
    type Ref,
} from 'vue';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export interface UseBreakpointReturn {
    deviceType: Readonly<Ref<DeviceType>>;
    isMobile: Readonly<Ref<boolean>>;
    isTablet: Readonly<Ref<boolean>>;
    isDesktop: Readonly<Ref<boolean>>;
}

export function useBreakpoint(): UseBreakpointReturn {
    const deviceType = ref<DeviceType>('desktop');

    const updateDeviceType = (): void => {
        const width = window.innerWidth;
        if (width < 641) {
            deviceType.value = 'mobile';
        } else if (width >= 641 && width < 1280) {
            deviceType.value = 'tablet';
        } else {
            deviceType.value = 'desktop';
        }
    };

    onMounted(() => {
        updateDeviceType();
        window.addEventListener('resize', updateDeviceType);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('resize', updateDeviceType);
    });

    const isMobile = computed(() => deviceType.value === 'mobile');
    const isTablet = computed(() => deviceType.value === 'tablet');
    const isDesktop = computed(() => deviceType.value === 'desktop');

    return {
        deviceType: readonly(deviceType),
        isMobile: readonly(isMobile),
        isTablet: readonly(isTablet),
        isDesktop: readonly(isDesktop),
    };
}
