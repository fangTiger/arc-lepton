import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    exclude: [
      ...configDefaults.exclude,
      'contracts/lib/**',
      'contracts/out/**',
      'contracts/cache/**',
      'contracts/broadcast/**',
    ],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
