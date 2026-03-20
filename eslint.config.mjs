export default [
  {
    ignores: [
      'node_modules/**',
      'cdk.out/**',
      '*.js',
      '*.d.ts',
      'dist/**',
      'build/**',
      'frontend/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: await import('@typescript-eslint/parser'),
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
];
