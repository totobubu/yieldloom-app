import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            'dist-*/**',
            '.git/**',
            '.npm/**',
            '.cache/**',
            '.vercel/**',
            '.agents/**',
            '.codex-remote-attachments/**',
            'venv/**',
            'public/**',
            'var/**',
            'tmp/**',
            'temp/**',
            'chrome_profile/**',
            '**/*.d.ts',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended.map((config) => ({
        ...config,
        files: ['**/*.{ts,tsx}'],
    })),
    ...vue.configs['flat/recommended'],
    {
        files: ['src/**/*.{js,ts,tsx,vue}'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: { parser: tseslint.parser },
        },
    },
    {
        files: [
            '*.{js,mjs,cjs,ts}',
            '{api,lib,scripts,tasks}/**/*.{js,mjs,cjs,ts}',
        ],
        languageOptions: { globals: globals.node },
    },
    {
        // Browser tests also run callbacks inside the page context.
        files: ['tests/**/*.{js,mjs,cjs,ts}'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    skipFormatting,
];
