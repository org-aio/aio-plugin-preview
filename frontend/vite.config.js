import { defineConfig } from 'vite'

// AIO 把插件资产挂在随会话变化的 token 路径下，必须使用相对资源地址。
export default defineConfig({
  base: './',
  build: {
    // 直接产出到插件包的 dist/frontend，避免二次拷贝。
    outDir: '../dist/frontend',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096
  },
  server: { port: 5173, host: '127.0.0.1' }
})
