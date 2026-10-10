// 表格：SheetJS 解析，按工作表渲染为 HTML 表格。
import * as XLSX from 'xlsx'
import { spreadsheetLayout } from './spreadsheet-layout.js'

const MAX_ROWS = 2000
const MAX_COLUMNS = 200

export default async function xlsx(container, file, helpers) {
  const workbook = XLSX.read(file.bytes, { type: 'array', cellDates: true, cellStyles: true })
  const layout = await spreadsheetLayout(file.bytes)
  const shell = document.createElement('div')
  shell.style.cssText = 'display:flex;flex-direction:column;min-height:100%'

  const tabs = document.createElement('div')
  tabs.style.cssText =
    'display:flex;gap:6px;overflow-x:auto;padding:10px 12px;border-bottom:1px solid #d7dee5;background:#fff'
  const body = document.createElement('div')
  body.style.cssText = 'flex:1;overflow:auto;background:#fff'
  shell.append(tabs, body)

  const controls = document.createElement('div')
  controls.className = 'viewer-toolbar'
  const fit = document.createElement('button')
  fit.textContent = '适应宽度'
  const actual = document.createElement('button')
  actual.textContent = '原始大小'
  const area = document.createElement('button')
  area.textContent = '查看完整工作表'
  controls.append(fit, actual, area)
  shell.insertBefore(controls, body)
  let usePrintArea = true
  let fitWidth = true
  let resize = () => {}
  fit.addEventListener('click', () => { fitWidth = true; resize() })
  actual.addEventListener('click', () => { fitWidth = false; resize() })
  area.addEventListener('click', () => { usePrintArea = !usePrintArea; const name = active; active = null; show(name) })
  const observer = new ResizeObserver(() => resize())
  observer.observe(body)
  let active = null
  const buttons = new Map()

  function show(name) {
    if (active === name) return
    active = name
    for (const [key, button] of buttons) {
      button.style.fontWeight = key === name ? '700' : '400'
      button.style.borderColor = key === name ? '#0f766e' : '#d7dee5'
      button.style.color = key === name ? '#0f766e' : 'inherit'
    }
    const sheet = workbook.Sheets[name]
    const info = layout?.sheets.get(name)
    const printArea = info?.printArea?.match(/^[A-Z]+[0-9]+:[A-Z]+[0-9]+$/)?.[0]
    const range = XLSX.utils.decode_range(usePrintArea && printArea ? printArea : sheet['!ref'] || 'A1')
    area.hidden = !printArea
    area.textContent = usePrintArea ? '查看完整工作表' : '仅显示打印区域'
    const table = document.createElement('table')
    table.className = 'spreadsheet-table'
    table.style.cssText = 'border-collapse:collapse;table-layout:fixed;color:#000;background:#fff'
    const lastRow = Math.min(range.e.r, MAX_ROWS - 1)
    const lastColumn = Math.min(range.e.c, MAX_COLUMNS - 1)
    const widths = []
    const colgroup = document.createElement('colgroup')
    for (let column = 0; column <= lastColumn; column++) {
      const definition = info?.columns[column]
      const width = definition?.hidden ? 0 : definition?.width ?? sheet['!cols']?.[column]?.wpx ?? 64
      widths.push(width)
      const col = document.createElement('col')
      col.style.width = `${width}px`
      colgroup.append(col)
    }
    table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`
    table.append(colgroup)
    const merges = sheet['!merges'] || []
    for (let row = 0; row <= lastRow; row++) {
      const definition = info?.rows.get(row)
      if (definition?.hidden) { continue }
      const tr = document.createElement('tr')
      tr.style.height = `${definition?.height || info?.defaultHeight || sheet['!rows']?.[row]?.hpt || 15}pt`
      for (let column = 0; column <= lastColumn; column++) {
        if (info?.columns[column]?.hidden) { continue }
        const merge = merges.find(item => row >= item.s.r && row <= item.e.r && column >= item.s.c && column <= item.e.c)
        if (merge && (row !== merge.s.r || column !== merge.s.c)) { continue }
        const address = XLSX.utils.encode_cell({ r: row, c: column })
        const cell = sheet[address]
        const td = document.createElement('td')
        td.dataset.cell = address
        td.textContent = cell ? XLSX.utils.format_cell(cell) : ''
        td.style.cssText = 'padding:0 2px;overflow:hidden;white-space:pre;font-size:11pt;vertical-align:bottom'
        if (info?.gridlines ?? true) { td.style.border = '1px solid #e2e8ee' }
        const styleId = info?.cells.get(address) ?? definition?.style ?? info?.columns[column]?.style ?? 0
        Object.assign(td.style, layout?.css[styleId] ?? {})
        if (!td.style.textAlign) { td.style.textAlign = cell?.t === 'n' ? 'right' : 'left' }
        if (merge) {
          td.rowSpan = Math.min(merge.e.r, lastRow) - row + 1
          td.colSpan = Math.min(merge.e.c, lastColumn) - column + 1
          // 合并区域的右侧、底部边框可能保存在尾单元格上。
          for (const [edge, position] of [['borderRight', {r: row, c: merge.e.c}], ['borderBottom', {r: merge.e.r, c: column}]]) {
            const edgeStyle = layout?.css[info?.cells.get(XLSX.utils.encode_cell(position))]
            if (edgeStyle?.[edge] && edgeStyle[edge] !== 'none') { td.style[edge] = edgeStyle[edge] }
          }
        }
        tr.append(td)
      }
      table.append(tr)
    }
    const notice = range.e.r >= MAX_ROWS || range.e.c >= MAX_COLUMNS ? '（超出预览范围的单元格已截断）' : ''
    const caption = document.createElement('p')
    caption.textContent = `工作表「${name}」· ${range.e.r + 1} 行 ${notice}`
    caption.style.cssText = 'margin:12px;font-size:12px;opacity:.7'
    const paper = document.createElement('div')
    paper.style.cssText = 'position:relative;margin:0 12px 12px'
    table.style.transformOrigin = 'top left'
    paper.append(table)
    body.replaceChildren(caption, paper)
    resize = () => {
      const width = widths.reduce((sum, value) => sum + value, 0)
      const scale = fitWidth ? Math.min(1, Math.max(0.1, (body.clientWidth - 24) / width)) : 1
      table.style.transform = `scale(${scale})`
      paper.style.width = `${width * scale}px`
      paper.style.height = `${table.offsetHeight * scale}px`
      table.style.position = 'absolute'
    }
    requestAnimationFrame(resize)
  }

  for (const name of workbook.SheetNames) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = name
    button.addEventListener('click', () => show(name))
    buttons.set(name, button)
    tabs.append(button)
  }
  container.replaceChildren(shell)
  if (workbook.SheetNames.length) show(workbook.SheetNames[0])
  return () => observer.disconnect()
}
