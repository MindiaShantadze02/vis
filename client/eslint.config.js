import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'cypress']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Vercel Edge Functions (SEO layer) run on the server, not in the browser:
    // they use process.env + Web fetch/Request/Response and aren't React.
    files: ['api/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.serviceworker },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
