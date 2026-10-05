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
