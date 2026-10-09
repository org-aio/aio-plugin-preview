import { api, hasHost } from './host.js'

const MAX_FILE_BYTES = 4 * 1024 * 1024

// 只保存已经打开的文件，按服务器时间保留 30 天；列表不携带文件正文。
export function mountHistory(openFile, getFiles, onChange) {
  const panel = document.getElementById('history-panel')
  const list = document.getElementById('history-list')
  const status = document.getElementById('history-status')
  const dialog = document.getElementById('history-delete-dialog')
  let pendingDelete = null
  let queue = Promise.resolve()
  let entries = []
  const fileIds = new WeakMap()
  const deleteButton = (entry) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'history-delete'
    button.textContent = '×'
    button.setAttribute('aria-label', `删除历史 ${entry.name}`)
    button.title = '删除历史副本'
    button.addEventListener('click', () => { pendingDelete = entry.id; dialog.showModal() })
    return button
  }
  const showError = (error) => { status.textContent = `历史保存失败：${error.message}` }
  const render = () => {
    const query = document.getElementById('file-filter').value.toLocaleLowerCase()
    list.replaceChildren()
    const openedIds = new Set(getFiles().map(file => fileIds.get(file)))
    const visible = entries.filter(item => !openedIds.has(item.id) && item.name.toLocaleLowerCase().includes(query))
    for (const entry of visible) {
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
          const reopened = new File([bytes], file.name, { type: file.mime })
          fileIds.set(reopened, entry.id)
          await openFile(reopened)
        } catch (error) { showError(error) }
        finally { button.disabled = false }
      })
      const metadata = `${new Date(entry.opened_at).toLocaleString()} · ${(entry.size / 1024).toFixed(1)} KB`
      row.append(button, deleteButton(entry))
      row.title = metadata
      list.append(row)
    }
    if (!visible.length) { list.textContent = query ? '无匹配的历史文件' : '暂无其他历史文件' }
  }
  const refresh = async () => {
    entries = await api('GET', '/api/history')
    onChange()
  }
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
    return { remember: () => {}, render: () => {}, decorate: () => {}, id: () => null }
  }
  void refresh().catch(showError)
  const remember = (file) => {
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
      const saved = await api('POST', '/api/history', { name: file.name, mime: file.type, content: btoa(binary) })
      fileIds.set(file, saved.id)
      await refresh()
      status.textContent = '已保存到 30 天浏览历史'
    }).catch(showError)
  }
  return { remember, render, id: file => fileIds.get(file), decorate: (file, row) => {
    const entry = entries.find(item => item.id === fileIds.get(file))
    if (entry) { row.append(deleteButton(entry)) }
  } }
}
