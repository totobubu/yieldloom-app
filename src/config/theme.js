import { definePreset } from '@primeuix/themes';
import Lara from '@primeuix/themes/lara';

// Shared by the app controls and teleported PrimeVue overlays.
export const MyPreset = definePreset(Lara, {
    semantic: {
        primary: {
            50: '#f0fdfa',
            100: '#ccfbf1',
            200: '#99f6e4',
            300: '#5eead4',
            400: '#2dd4bf',
            500: '#0d7a6e',
            600: '#0d7a6e',
            700: '#0d7a6e',
            800: '#005f55',
            900: '#005048',
            950: '#00201c',
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
                    color: '#0d7a6e',
                    contrastColor: '#ffffff',
                    hoverColor: '#005f55',
                    activeColor: '#005048',
                },
                highlight: {
                    background: '#f0fdfa',
                    focusBackground: '#ccfbf1',
                    color: '#0d7a6e',
                    focusColor: '#005f55',
                },
                surface: {
                    0: '#ffffff',
                    50: '#f8fafc',
                    100: '#f2f4f6',
                    200: '#e2e8f0',
                    300: '#cbd5e1',
                    400: '#94a3b8',
                    500: '#64748b',
                    600: '#526174',
                    700: '#334155',
                    800: '#1e293b',
                    900: '#1e293b',
                    950: '#0b1220',
                },
            },
            dark: {
                primary: {
                    color: '#7dd6c8',
                    contrastColor: '#0b1220',
                    hoverColor: '#abfff0',
                    activeColor: '#2dd4bf',
                },
                highlight: {
                    background: '#103c36',
                    focusBackground: '#1b5149',
                    color: '#abfff0',
                    focusColor: '#ccfbf1',
                },
                surface: {
                    0: '#ffffff',
                    50: '#f2f4f6',
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
