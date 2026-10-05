// 渲染器注册表：渲染器标识 → 懒加载模块。
// 所有渲染器共用同一接口 `render(container, file, helpers)`，其中
// file = { name, extension, mime, bytes: Uint8Array }，返回可选的清理函数。

const VIEWERS = {
  image: () => import('./viewers/image.js'),
  video: () => import('./viewers/media.js').then((m) => m.video),
  audio: () => import('./viewers/media.js').then((m) => m.audio),
  pdf: () => import('./viewers/pdf.js'),
  markdown: () => import('./viewers/markdown.js'),
  docx: () => import('./viewers/docx.js'),
  xlsx: () => import('./viewers/xlsx.js'),
  dwg: () => import('./viewers/dwg.js'),
  model: () => import('./viewers/model.js'),
  text: () => import('./viewers/text.js'),
  archive: () => import('./viewers/archive.js'),
  download: () => import('./viewers/download.js')
}

export function renderers() {
  return Object.keys(VIEWERS)
}

export function extensionOf(name) {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const index = base.lastIndexOf('.')
  if (index <= 0 || index === base.length - 1) return ''
  return base.slice(index + 1).toLowerCase()
}

export async function load(renderer) {
  const factory = VIEWERS[renderer] ?? VIEWERS.download
  const module = await factory()
  return module.default ?? module
}

// 前端内置兜底表：后端 `/api/formats` 不可用（独立开发、离线）时仍然可用。
export const FALLBACK_FORMATS = [
  { renderer: 'image', category: 'image', label: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tif', 'tiff'] },
  { renderer: 'pdf', category: 'document', label: 'PDF', extensions: ['pdf'] },
  { renderer: 'video', category: 'media', label: '视频', extensions: ['mp4', 'webm', 'ogv', 'mov', 'm4v'] },
  { renderer: 'audio', category: 'media', label: '音频', extensions: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'] },
  { renderer: 'markdown', category: 'document', label: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
  { renderer: 'docx', category: 'document', label: 'Word', extensions: ['docx'] },
  { renderer: 'xlsx', category: 'document', label: '表格', extensions: ['xlsx', 'xls', 'xlsm', 'ods'] },
  { renderer: 'dwg', category: 'cad', label: 'CAD 图纸', extensions: ['dwg', 'dxf'] },
  { renderer: 'model', category: 'model', label: '3D 模型', extensions: ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae', '3ds', '3mf', 'vtk', 'pcd', 'xyz'] },
  { renderer: 'archive', category: 'archive', label: '压缩包', extensions: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'] },
  { renderer: 'text', category: 'code', label: '文本与代码', extensions: ['txt', 'log', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'py', 'rs', 'go', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rb', 'php', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte', 'css', 'scss', 'less', 'html', 'htm', 'sql', 'gql', 'graphql', 'proto', 'dockerfile', 'makefile', 'gradle', 'lua', 'swift', 'dart', 'scala', 'r', 'm', 'pl', 'vim'] }
]

/** 把格式表展开成扩展名 → 渲染器映射，供 O(1) 查表。 */
export function tableFrom(formats) {
  const table = new Map()
  for (const format of formats || []) {
    for (const extension of format.extensions || []) table.set(extension, format.renderer)
  }
  return table
}
