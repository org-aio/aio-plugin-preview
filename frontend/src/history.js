import { api, hasHost } from './host.js'

const MAX_FILE_BYTES = 4 * 1024 * 1024

// 只保存已经打开的文件，按服务器时间保留 30 天；列表不携带文件正文。
export function mountHistory(openFile) {
  const panel = document.getElementById('history-panel')
  const list = document.getElementById('history-list')
  const status = document.getElementById('history-status')
  const dialog = document.getElementById('history-delete-dialog')
  let pendingDelete = null
  let queue = Promise.resolve()
  let entries = []
  const showError = (error) => { status.textContent = `历史保存失败：${error.message}` }
  const render = () => {
    const query = document.getElementById('history-filter').value.toLocaleLowerCase()
    list.replaceChildren()
    for (const entry of entries.filter((item) => item.name.toLocaleLowerCase().includes(query))) {
      const row = document.createElement('div')
      row.className = 'history-row'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'history-open'
      button.textContent = entry.name
      button.title = '重新打开历史文件'
      button.addEventListener('click', async () => {
        button.disabled = true
        try {
          const file = await api('POST', '/api/history/open', { id: entry.id })
          const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0))
          await openFile(new File([bytes], file.name, { type: file.mime }))
        } catch (error) { showError(error) }
        finally { button.disabled = false }
      })
      const meta = document.createElement('span')
      meta.className = 'file-meta'
      meta.textContent = `${new Date(entry.opened_at).toLocaleString()} · ${(entry.size / 1024).toFixed(1)} KB`
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = '删除'
      remove.setAttribute('aria-label', `删除历史 ${entry.name}`)
      remove.addEventListener('click', () => { pendingDelete = entry.id; dialog.showModal() })
      row.append(button, meta, remove)
      list.append(row)
    }
    if (!entries.length) { list.textContent = '暂无浏览历史' }
  }
  const refresh = async () => {
    entries = await api('GET', '/api/history')
    render()
  }
  document.getElementById('history-filter').addEventListener('input', render)
  document.getElementById('history-clear').addEventListener('click', () => {
    pendingDelete = 'all'
    dialog.showModal()
  })
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'delete' || !pendingDelete) { return }
    const id = pendingDelete
    queue = queue.then(async () => {
      await api('DELETE', id === 'all' ? '/api/history/all' : '/api/history', id === 'all' ? undefined : { id })
      await refresh()
      status.textContent = '历史已删除'
    }).catch(showError)
  })
  if (!hasHost()) {
    panel.hidden = true
    return () => {}
  }
  void refresh().catch(showError)
  return (file) => {
    if (file.size > MAX_FILE_BYTES) {
      status.textContent = '该文件超过 4 MiB，未保存到历史；仍可正常预览'
      return
    }
    queue = queue.then(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
      }
      await api('POST', '/api/history', { name: file.name, mime: file.type, content: btoa(binary) })
      await refresh()
      status.textContent = '已保存到 30 天浏览历史'
    }).catch(showError)
  }
}
