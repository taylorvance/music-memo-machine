import defineReactAppConfig from '@taylorvance/tv-shared-dev/eslint/react-app';
import globals from 'globals';

export default [
  ...defineReactAppConfig({
    extraIgnores: ['coverage/**', 'library/**', '.vite/**'],
  }),
  {
    files: [
      'eslint.config.mjs',
      'prettier.config.mjs',
      'vite.config.ts',
      'scripts/**/*.mjs',
      'server/**/*.js',
      'tests/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/App.tsx'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
