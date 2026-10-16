import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'backups/',
      'src-tauri/target/',
      'src-tauri/gen/',
      '.pnpm-store/',
      '.pnpm-cache/',
      '.pnpm-state/',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactRefresh.configs.vite,
      // 必须放最后：关闭与 Prettier 冲突的格式类规则
      prettier,
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // 只启用 React 18 的经典两条；react-hooks v7 的 Compiler 规则
      // (set-state-in-effect / refs / immutability …) 要求重构现有 ref 与同步 setState 写法，
      // 对未启用 React Compiler 的项目是噪音，故不在此启用。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // i18n 等文件同时导出组件与 hook 是有意为之，仅提示不阻塞
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
);
