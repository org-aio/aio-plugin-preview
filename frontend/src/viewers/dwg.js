// DWG/DXF：libredwg 编译的 WebAssembly 在浏览器内直接解析私有格式，
// 不需要云端转换服务；渲染由本地的 dwg-render 完成，能对单个坏实体兜底。
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web'
import { renderDatabase } from './dwg-render.js'
import { parseDxf } from './dxf.js'

// WASM 放在入口同级目录（构建时从依赖复制，见 scripts/build.sh）。
// 该包只导出入口、不允许深引用 wasm 子路径，因此不能走打包器的资源导入；
// 隔离挂载会把插件目录下的普通文件原样提供，固定名地址稳定可用。
const WASM_BASE = new URL('.', document.baseURI).href.replace(/\/$/, '')

let instancePromise = null

function loadLibreDwg() {
  if (!instancePromise) {
    instancePromise = LibreDwg.create(WASM_BASE).catch((error) => {
      instancePromise = null
      throw new Error(`DWG 解析引擎加载失败：${error?.message ?? error}`)
    })
  }
  return instancePromise
}

/**
 * 复用一个 WASM 实例（初始化约 50ms），但解析失败后立即丢弃重建。
 * libredwg 在遇到个别不受支持的图纸时会触发 WASM abort 并让实例进入不可用状态，
 * 重建能保证一个坏文件不影响后续其它文件。
 */
async function withLibreDwg(work) {
  const instance = await loadLibreDwg()
  try {
    return work(instance)
  } catch (error) {
    instancePromise = null
    LibreDwg.instance = undefined
    throw error
  }
}

// 缩放与平移：滚轮缩放、拖动平移，视图变换只作用在 SVG 上。
function attachNavigation(svg) {
  let scale = 1
  let x = 0
  let y = 0
  let dragging = false
  let lastX = 0
  let lastY = 0

  svg.style.transformOrigin = '0 0'
  svg.style.cursor = 'grab'
  const apply = () => {
    svg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }
  apply()

  const onWheel = (event) => {
    event.preventDefault()
    const next = Math.min(80, Math.max(0.05, scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
    const ratio = next / scale
    const rect = svg.getBoundingClientRect()
    x -= (event.clientX - rect.left) * (ratio - 1)
    y -= (event.clientY - rect.top) * (ratio - 1)
    scale = next
    apply()
  }
  const onDown = (event) => {
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    svg.style.cursor = 'grabbing'
  }
  const onMove = (event) => {
    if (!dragging) return
    x += event.clientX - lastX
    y += event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    apply()
  }
  const onUp = () => {
    dragging = false
    svg.style.cursor = 'grab'
  }

  svg.addEventListener('wheel', onWheel, { passive: false })
  svg.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  return () => {
    svg.removeEventListener('wheel', onWheel)
    svg.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
}

export default async function dwg(container, file, helpers) {
  // DXF 是文本格式，且随包的 libredwg 构建不含 DXF 读取器，直接用 dxf-parser。
  const isDxf = file.extension === 'dxf' || looksLikeDxf(file.bytes)
  let database = null
  if (isDxf) {
    try {
      database = parseDxf(new TextDecoder('utf-8').decode(file.bytes))
    } catch {
      database = null
    }
  }
  // 其余情况（以及被误命名的 DXF）走 libredwg 的 DWG 读取器。
  if (!database) {
    try {
      database = await withLibreDwg((libredwg) => {
        const source = file.bytes.buffer.slice(
          file.bytes.byteOffset,
          file.bytes.byteOffset + file.bytes.byteLength
        )
        const pointer = libredwg.dwg_read_data(source, Dwg_File_Type.DWG)
        if (!pointer) return null
        try {
          return libredwg.convert(pointer)
        } finally {
          libredwg.dwg_free(pointer)
        }
      })
    } catch {
      database = null
    }
  }
  if (!database) {
    const version = readVersion(file.bytes)
    throw new Error(
      `图纸解析失败（识别版本 ${version || '未知'}）：文件可能损坏，或版本超出内置解析引擎支持范围`
    )
  }

  const result = renderDatabase(database)

  const version = database.header?.ACADVER || readVersion(file.bytes)
  const layers = (database.tables?.LAYER?.entries ?? []).length
  const notes = [`实体 ${result.entityCount} 个`, `图层 ${layers} 个`]
  if (version) notes.push(version)
  if (result.skipped) {
    const types = result.skippedTypes.length ? `（${result.skippedTypes.join('、')}）` : ''
    notes.push(`跳过 ${result.skipped} 个暂不支持的实体${types}`)
  }
  helpers.report(`已解析 ${file.extension.toUpperCase()} 图纸 · ${notes.join(' · ')}`)

  const viewport = document.createElement('div')
  viewport.style.cssText = 'width:100%;height:100%;min-height:480px;overflow:hidden;background:#fff'
  const host = document.createElement('div')
  host.innerHTML = result.svg
  viewport.append(host)
  container.replaceChildren(viewport)

  const svg = host.querySelector('svg')
  svg.style.maxWidth = 'none'
  svg.style.display = 'block'
  return attachNavigation(svg)
}

// DXF 以分组码文本开头，据此容忍扩展名与实际内容不一致的文件。
function looksLikeDxf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512))
  return /^\s*0\s*\r?\nSECTION/m.test(head) || /^\s*999\s*\r?\n/.test(head)
}

// DWG 头部固定带 AC10xx 版本号，用于给出可读的错误提示。
function readVersion(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 6))
  return /^AC10\d\d$/.test(head) ? head : ''
}
