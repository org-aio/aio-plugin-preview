// 把 libredwg 的 .wasm 复制到 public/，供构建与本地开发按固定名访问。
// 该包只导出入口、不允许深引用 wasm 子路径，因此不能走打包器的资源导入；
// 复制到 public/ 后由 Vite 原样发布，隔离挂载即可按相对路径提供。
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'public/libredwg-web.wasm')
mkdirSync(dirname(target), { recursive: true })
copyFileSync(
  resolve(root, 'node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm'),
  target
)
console.log('已复制 libredwg-web.wasm → public/')
