// 宿主桥接：优先使用 AIO 注入的 window.aioPlugin，本地独立开发时回退到同源接口。
const bridge = () => globalThis.window?.aioPlugin

export const hasHost = () => Boolean(bridge())

export async function api(method, path, value) {
  const plugin = bridge()
  if (!plugin) {
    const response = await fetch(path, {
      method,
      headers: value === undefined ? {} : { 'content-type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value)
    })
    if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status}`)
    return response.json()
  }
  return plugin.json(method, path, value)
}

export async function identity() {
  if (!hasHost()) return { tenant_id: '', user_id: '' }
  try {
    return await api('GET', '/api/context')
  } catch {
    return { tenant_id: '', user_id: '' }
  }
}

export async function capabilities() {
  try {
    return await api('GET', '/api/formats')
  } catch {
    return null
  }
}

// 隔离 iframe 的下载必须由宿主执行，独立开发时使用浏览器原生下载。
export async function downloadFile(file) {
  const plugin = bridge()
  if (plugin) {
    if (!plugin.download) { throw new Error('宿主暂不支持文件下载，请刷新页面加载新版本') }
    if (file.size > 16 * 1024 * 1024) { throw new Error('文件超过宿主下载上限 16 MiB') }
    const bytes = new Uint8Array(await file.arrayBuffer())
    await plugin.download(file.name, bytes, file.type || 'application/octet-stream')
    return
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
