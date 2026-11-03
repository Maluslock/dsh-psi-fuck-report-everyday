import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 客户端测试是手写 CJS + node:test，由 `pnpm test:client` 单独跑；
    // vitest 只负责宿主侧 TypeScript 测试，避免 ESM 环境加载 CJS 测试文件。
    include: ['tests/**/*.test.ts'],
  },
})
