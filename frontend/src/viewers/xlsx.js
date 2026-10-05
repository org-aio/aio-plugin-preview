// 表格：SheetJS 解析，按工作表渲染为 HTML 表格。
import * as XLSX from 'xlsx'

const MAX_ROWS = 2000
const MAX_COLUMNS = 200

export default function xlsx(container, file, helpers) {
  const workbook = XLSX.read(file.bytes, { type: 'array', cellDates: true })
  const shell = document.createElement('div')
  shell.style.cssText = 'display:flex;flex-direction:column;min-height:100%'

  const tabs = document.createElement('div')
  tabs.style.cssText =
    'display:flex;gap:6px;overflow-x:auto;padding:10px 12px;border-bottom:1px solid #d7dee5;background:#fff'
  const body = document.createElement('div')
  body.style.cssText = 'flex:1;overflow:auto;background:#fff'
  shell.append(tabs, body)

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
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    const table = document.createElement('table')
    table.style.cssText = 'border-collapse:collapse;font-size:12.5px;min-width:100%'
    const limit = Math.min(rows.length, MAX_ROWS)
    for (let index = 0; index < limit; index += 1) {
      const tr = document.createElement('tr')
      const cells = rows[index].slice(0, MAX_COLUMNS)
      for (const value of cells) {
        const td = document.createElement('td')
        td.textContent = value == null ? '' : String(value)
        td.style.cssText =
          'border:1px solid #e2e8ee;padding:4px 8px;white-space:pre;max-width:420px;overflow:hidden;text-overflow:ellipsis'
        if (index === 0) td.style.background = '#f4f6f8'
        tr.append(td)
      }
      table.append(tr)
    }
    const notice = rows.length > MAX_ROWS
      ? `（已截断显示前 ${MAX_ROWS} 行，共 ${rows.length} 行）`
      : ''
    const caption = document.createElement('p')
    caption.textContent = `工作表「${name}」· ${rows.length} 行 ${notice}`
    caption.style.cssText = 'margin:12px;font-size:12px;opacity:.7'
    body.replaceChildren(caption, table)
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
  return undefined
}
