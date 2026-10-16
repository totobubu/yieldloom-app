import { definePreset } from '@primeuix/themes';
import Lara from '@primeuix/themes/lara';

// Shared by the app controls and teleported PrimeVue overlays.
export const MyPreset = definePreset(Lara, {
    semantic: {
        primary: {
            50: '#eff6ff',
            100: '#dbeafe',
            200: '#bfdbfe',
            300: '#93c5fd',
            400: '#60a5fa',
            500: '#3b82f6',
            600: '#2563eb',
            700: '#1d4ed8',
            800: '#1e40af',
            900: '#1e3a8a',
            950: '#172554',
        },
        borderRadius: {
            xs: '4px',
            sm: '8px',
            md: '12px',
            lg: '16px',
            xl: '20px',
        },
        focusRing: {
            width: '2px',
            style: 'solid',
            color: '{primary.color}',
            offset: '3px',
        },
        formField: {
            paddingX: '0.875rem',
            paddingY: '0.75rem',
            borderRadius: '10px',
        },
        colorScheme: {
            light: {
                primary: {
                    color: '#1d4ed8',
                    contrastColor: '#ffffff',
                    hoverColor: '#1e40af',
                    activeColor: '#1e3a8a',
                },
                highlight: {
                    background: '#eff6ff',
                    focusBackground: '#dbeafe',
                    color: '#1d4ed8',
                    focusColor: '#1e40af',
                },
                surface: {
                    0: '#ffffff',
                    50: '#f6f8fb',
                    100: '#f1f5f9',
                    200: '#dce3ec',
                    300: '#cbd5e1',
                    400: '#94a3b8',
                    500: '#64748b',
                    600: '#526174',
                    700: '#334155',
                    800: '#1e293b',
                    900: '#172033',
                    950: '#0b1220',
                },
            },
            dark: {
                primary: {
                    color: '#8ab4ff',
                    contrastColor: '#0b1220',
                    hoverColor: '#b7cfff',
                    activeColor: '#60a5fa',
                },
                highlight: {
                    background: '#1c3152',
                    focusBackground: '#253e65',
                    color: '#b7cfff',
                    focusColor: '#dbeafe',
                },
                surface: {
                    0: '#ffffff',
                    50: '#f1f5f9',
                    100: '#e2e8f0',
                    200: '#cbd5e1',
                    300: '#b3c0d1',
                    400: '#94a3b8',
                    500: '#64748b',
                    600: '#526174',
                    700: '#35445b',
                    800: '#1c2b42',
                    900: '#142033',
                    950: '#0b1220',
                },
            },
        },
    },
    components: {
        button: {
            root: {
                borderRadius: '10px',
                paddingX: '1rem',
                paddingY: '0.75rem',
                gap: '0.5rem',
            },
        },
        card: {
            root: {
                borderRadius: '16px',
                shadow: '0 1px 3px rgba(23,32,51,0.04)',
            },
            body: { padding: '1.5rem' },
        },
        dialog: { root: { borderRadius: '18px' } },
    },
});
