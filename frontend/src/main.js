import '../styles.css'
import { capabilities, downloadFile, hasHost, identity } from './host.js'
import { extensionOf, FALLBACK_FORMATS, load, tableFrom } from './registry.js'

const dom = {
  stage: document.getElementById('stage'),
  list: document.getElementById('file-list'),
  filter: document.getElementById('file-filter'),
  workspace: document.getElementById('workspace'),
  dropzone: document.getElementById('dropzone'),
  formats: document.getElementById('formats'),
  input: document.getElementById('file-input'),
  pick: document.getElementById('pick'),
  clear: document.getElementById('clear'),
  name: document.getElementById('file-name'),
  meta: document.getElementById('file-meta'),
  renderer: document.getElementById('renderer'),
  download: document.getElementById('download'),
  context: document.getElementById('host-context'),
  note: document.getElementById('note'),
  error: document.getElementById('error')
}

let files = []
let currentFile = null
let generation = 0
const drafts = new Map()
let table = new Map()
let objectUrl = null
let disposeCurrent = null

// 解析信息（格式、实体数、跳过项）与实际错误分开显示，避免把提示当成失败。
function report(message) {
  dom.note.textContent = message ?? ''
}
function fail(message) {
  dom.error.textContent = message ?? ''
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

// 把与「已打开文件」相关的界面状态全部复位，避免清空后残留文件名。
function reset() {
  report('')
  fail('')
  dom.name.textContent = ''
  dom.meta.textContent = ''
  dom.renderer.textContent = ''
  dom.download.removeAttribute('href')
  dom.download.removeAttribute('download')
}

function release() {
  if (typeof disposeCurrent === 'function') {
    try {
      disposeCurrent()
    } catch (error) {
      console.error(error)
    }
  }
  disposeCurrent = null
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  dom.stage.replaceChildren()
  dom.stage.classList.remove('loading')
}

function rendererFor(file) {
  return table.get(extensionOf(file.name)) ?? 'download'
}

async function open(file) {
  const ticket = ++generation
  currentFile = file
  renderFileList()
  release()
  reset()
  const renderer = rendererFor(file)
  const bytes = new Uint8Array(await (drafts.get(file)?.file ?? file).arrayBuffer())
  if (ticket !== generation) { return }
  const input = { name: file.name, mime: file.type, extension: extensionOf(file.name), bytes }

  dom.workspace.hidden = false
  dom.dropzone.hidden = true
  dom.name.textContent = file.name
  dom.meta.textContent = `${formatBytes(bytes.byteLength)} · ${renderer}`
  dom.renderer.textContent = renderer
  objectUrl = URL.createObjectURL(drafts.get(file)?.file ?? file)
  dom.download.href = objectUrl
  dom.download.setAttribute('download', file.name)
  dom.stage.classList.add('loading')

  try {
    const viewer = await load(renderer)
    if (ticket !== generation) { return }
    const host = document.createElement('div')
    host.style.cssText = 'width:100%;height:100%'
    dom.stage.replaceChildren(host)
    const helpers = {
      objectUrl: () => URL.createObjectURL(new Blob([input.bytes], { type: input.mime || undefined })),
      revoke: (url) => URL.revokeObjectURL(url),
      report: (message) => { if (ticket === generation) { report(message) } },
      fail: (message) => { if (ticket === generation) { fail(message) } },
      updateDraft: (text) => {
        drafts.set(file, { file: new File([text], file.name, { type: 'text/markdown' }), dirty: true })
        renderFileList()
      },
      exportFile: (name, data, mime) => exportFile(name, data, mime, file)
    }
    const cleanup = await viewer(host, input, helpers)
    if (ticket !== generation) {
      if (typeof cleanup === 'function') { cleanup() }
      return
    }
    dom.stage.replaceChildren(host)
    if (typeof cleanup === 'function') { disposeCurrent = cleanup }
  } catch (error) {
    if (ticket !== generation) { return }
    console.error(error)
    fail(`无法预览「${file.name}」：${error?.message ?? error}`)
    const fallback = await load('download')
    if (ticket !== generation) { return }
    await fallback(dom.stage, input, { objectUrl: () => objectUrl })
  } finally {
    if (ticket === generation) { dom.stage.classList.remove('loading') }
  }
}

async function openFiles(pickedFiles) {
  const list = Array.from(pickedFiles ?? [])
  if (!list.length) return
  files.push(...list)
  await open(list[0])
}

function renderFileList() {
  const query = dom.filter.value.toLocaleLowerCase()
  const buttons = files.filter((file) => file.name.toLocaleLowerCase().includes(query)).map((file) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `${file.name}${drafts.get(file)?.dirty ? ' · 未下载' : ''}`
    button.setAttribute('aria-current', String(file === currentFile))
    button.addEventListener('click', () => { void open(file) })
    return button
  })
  dom.list.replaceChildren(...buttons)
}

// 下载一份新文件，并立即在当前工作区打开；源文件保持原样。
async function exportFile(name, data, mime, source) {
  const stem = name.replace(/\.[^.]+$/, '')
  const extension = extensionOf(name)
  const output = new File([data], `${stem}-edited.${extension}`, { type: mime })
  try {
    await downloadFile(output)
  } catch (error) {
    fail(`下载失败：${error.message}`)
    return
  }
  if (!files.includes(source)) { return }
  const draft = drafts.get(source)
  if (draft) { draft.dirty = false }
  files.push(output)
  void open(output)
}

dom.filter.addEventListener('input', renderFileList)
dom.download.addEventListener('click', async (event) => {
  event.preventDefault()
  if (!currentFile) { return }
  try {
    await downloadFile(drafts.get(currentFile)?.file ?? currentFile)
  } catch (error) {
    fail(`下载失败：${error.message}`)
  }
})

function wireFormats() {
  const seen = new Set()
  const chips = []
  for (const [extension, renderer] of table) {
    const key = `${renderer}:${extension}`
    if (seen.has(key)) continue
    seen.add(key)
    chips.push(`<span class="chip">${extension}</span>`)
  }
  dom.formats.innerHTML = chips.sort().slice(0, 96).join('')
}

dom.pick.addEventListener('click', () => dom.input.click())
dom.input.addEventListener('change', () => {
  void openFiles(dom.input.files)
  dom.input.value = ''
})
function clearFiles() {
  generation += 1
  files = []
  currentFile = null
  drafts.clear()
  dom.filter.value = ''
  renderFileList()
  release()
  reset()
  dom.workspace.hidden = true
  dom.dropzone.hidden = false
}

const clearDialog = document.getElementById('clear-dialog')
dom.clear.addEventListener('click', () => {
  if ([...drafts.values()].some((draft) => draft.dirty)) {
    clearDialog.showModal()
    return
  }
  clearFiles()
})
clearDialog.addEventListener('close', () => {
  if (clearDialog.returnValue === 'clear') { clearFiles() }
})

for (const type of ['dragenter', 'dragover']) {
  dom.dropzone.addEventListener(type, (event) => {
    event.preventDefault()
    dom.dropzone.classList.add('dragging')
  })
}
for (const type of ['dragleave', 'drop']) {
  dom.dropzone.addEventListener(type, (event) => {
    event.preventDefault()
    dom.dropzone.classList.remove('dragging')
  })
}
dom.dropzone.addEventListener('drop', (event) => {
  void openFiles(event.dataTransfer?.files)
})
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => event.preventDefault())

async function boot() {
  const [caps, me] = await Promise.all([capabilities(), identity()])
  table = tableFrom(caps?.formats?.length ? caps.formats : FALLBACK_FORMATS)
  wireFormats()
  dom.context.textContent = hasHost()
    ? `宿主租户 ${me.tenant_id || '未提供'} · 用户 ${me.user_id || '未提供'}`
    : '独立开发模式（未连接 AIO 宿主）'
}

void boot()
