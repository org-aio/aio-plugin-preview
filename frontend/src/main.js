import '../styles.css'
import { capabilities, hasHost, identity } from './host.js'
import { extensionOf, FALLBACK_FORMATS, load, tableFrom } from './registry.js'

const dom = {
  stage: document.getElementById('stage'),
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
  release()
  report('')
  fail('')
  const renderer = rendererFor(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const input = { name: file.name, mime: file.type, extension: extensionOf(file.name), bytes }

  dom.workspace.hidden = false
  dom.dropzone.hidden = true
  dom.name.textContent = file.name
  dom.meta.textContent = `${formatBytes(bytes.byteLength)} · ${renderer}`
  dom.renderer.textContent = renderer
  objectUrl = URL.createObjectURL(file)
  dom.download.href = objectUrl
  dom.download.setAttribute('download', file.name)
  dom.stage.classList.add('loading')

  try {
    const viewer = await load(renderer)
    const helpers = {
      objectUrl: () => URL.createObjectURL(new Blob([input.bytes], { type: input.mime || undefined })),
      revoke: (url) => URL.revokeObjectURL(url),
      report,
      fail
    }
    const cleanup = await viewer(dom.stage, input, helpers)
    if (typeof cleanup === 'function') disposeCurrent = cleanup
  } catch (error) {
    console.error(error)
    fail(`无法预览「${file.name}」：${error?.message ?? error}`)
    const fallback = await load('download')
    await fallback(dom.stage, input, { objectUrl: () => objectUrl })
  } finally {
    dom.stage.classList.remove('loading')
  }
}

async function openFiles(files) {
  const list = Array.from(files ?? [])
  if (!list.length) return
  if (list.length > 1) report(`本次仅预览第一个文件，共选择 ${list.length} 个`)
  await open(list[0])
}

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
dom.clear.addEventListener('click', () => {
  release()
  report('')
  fail('')
  dom.workspace.hidden = true
  dom.dropzone.hidden = false
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
