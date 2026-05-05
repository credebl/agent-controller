import { fileURLToPath } from 'url';
import { dirname } from 'path';
import eslintPluginImport from 'eslint-plugin-import';
import eslintPluginPrettier from 'eslint-plugin-prettier';
import eslintPluginTypescript from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  {
    ignores: ['**/build/**', '**/*.js', '**/*.d.ts'],
  },
  {
    ignores: [
      '**/tests/*',
    ],
    files: ['**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.eslint.json'],
        sourceType: 'module',
      },
      globals: {
        console: false, // no-console rule
      },
    },
    plugins: {
      '@typescript-eslint': eslintPluginTypescript,
      import: eslintPluginImport,
      prettier: eslintPluginPrettier,
    },
    rules: {
      'no-constant-condition': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
      '@typescript-eslint/explicit-member-accessibility': 'error',
      'no-console': 'error',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
      'import/no-cycle': 'error',
      'import/order': [
        'error',
        {
          groups: ['type', ['builtin', 'external'], 'parent', 'sibling', 'index'],
          alphabetize: {
            order: 'asc',
          },
          'newlines-between': 'always',
        },
      ],
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: false,
        },
      ],
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['jest.config.ts', 'eslint.config.js'],
    languageOptions: {
      parserOptions: {
        sourceType: 'commonjs',
      },
      globals: {
        require: true,
        module: true,
        __dirname: true,
      },
    },
  },
  {
    files: ['*.test.ts', '**/__tests__/**', '**/tests/**', 'jest.*.ts', '**/samples/**'],
    languageOptions: {
      globals: {
        describe: true,
        test: true,
        expect: true,
        jest: true,
      },
    },
    rules: {
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: true,
        },
      ],
    },
  },
];
