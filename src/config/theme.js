import { definePreset } from '@primeuix/themes';
import Lara from '@primeuix/themes/lara';

export const MyPreset = definePreset(Lara, {
    semantic: {
        primary: {
            50: '#fff8e1',
            100: '#ffecb3',
            200: '#ffe082',
            300: '#ffd54f',
            400: '#ffca28',
            500: '#ffc107', // Rich Amber
            600: '#ffb300',
            700: '#ffa000',
            800: '#ff8f00',
            900: '#ff6f00',
            950: '#452000',
        },
        colorScheme: {
            light: {
                primary: {
                    color: '#ffc107',
                    inverseColor: '#1f2937',
                    contrastColor: '#1f2937',
                    hoverColor: '#ffca28',
                    activeColor: '#ffb300',
                },
                highlight: {
                    background: 'rgba(255, 193, 7, 0.12)',
                    focusBackground: 'rgba(255, 193, 7, 0.18)',
                    color: '#1f2937',
                    focusColor: '#111827',
                },
                formField: {
                    hoverBorderColor: '{primary.hoverColor}',
                },
            },
            dark: {
                primary: {
                    color: '#ffe082',
                    inverseColor: '#111827',
                    contrastColor: '#111827',
                    hoverColor: '#ffecb3',
                    activeColor: '#ffc107',
                },
                highlight: {
                    background: 'rgba(255, 224, 130, 0.16)',
                    focusBackground: 'rgba(255, 224, 130, 0.24)',
                    color: 'rgba(255,255,255,.87)',
                    focusColor: 'rgba(255,255,255,.87)',
                },
                formField: {
                    hoverBorderColor: '{primary.color}',
                },
            },
        },
        focusRing: {
            width: '2px',
            style: 'dashed',
            color: '{primary.color}',
            offset: '1px',
        },
    },
    components: {
        card: {
            colorScheme: {
                light: {
                    root: {
                        background: '{surface.0}',
                        color: '{surface.900}',
                    },
                    subtitle: {
                        color: '{surface.500}',
                    },
                },
                dark: {
                    root: {
                        background: '{surface.900}',
                        color: '{surface.0}',
                    },
                    subtitle: {
                        color: '{surface.400}',
                    },
                },
            },
        },
    },
});
