import JSZip from 'jszip'

const children = (node, name) => [...(node?.children ?? [])].filter(child => child.localName === name)
const child = (node, name) => children(node, name)[0]
const attr = (node, name, fallback = '') => node?.getAttribute(name) ?? fallback
const xml = text => new DOMParser().parseFromString(text, 'application/xml')

// 从原始 OOXML 读取 SheetJS 社区版未保留的字体、边框和对齐信息。
export async function spreadsheetLayout(bytes) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) { return null }
  const zip = await JSZip.loadAsync(bytes)
  if (!zip.file('xl/workbook.xml')) { return null }
  const read = async path => zip.file(path) ? xml(await zip.file(path).async('string')) : null
  const styles = (await read('xl/styles.xml'))?.documentElement
  const theme = await read('xl/theme/theme1.xml')
  const scheme = theme?.getElementsByTagNameNS('*', 'clrScheme')[0]
  const palette = [...(scheme?.children ?? [])].map(node => attr(node.firstElementChild, 'lastClr', attr(node.firstElementChild, 'val')))
  // Excel 的主题索引顺序不同于主题 XML 中的顺序。
  ;[palette[0], palette[1], palette[2], palette[3]] = [palette[1], palette[0], palette[3], palette[2]]
  const color = node => {
    const rgb = attr(node, 'rgb') || palette[Number(attr(node, 'theme', '-1'))]
    if (!rgb || !/^[a-f\d]{6,8}$/i.test(rgb)) { return '#000000' }
    const channels = rgb.slice(-6).match(/../g).map(value => parseInt(value, 16))
    const tint = Number(attr(node, 'tint', '0'))
    return `rgb(${channels.map(value => Math.round(tint < 0 ? value * (1 + tint) : value + (255 - value) * tint)).join(',')})`
  }
  const fonts = children(child(styles, 'fonts'), 'font')
  const fills = children(child(styles, 'fills'), 'fill')
  const borders = children(child(styles, 'borders'), 'border')
  const formats = children(child(styles, 'cellXfs'), 'xf')
  const border = node => {
    const style = attr(node, 'style')
    if (!style) { return 'none' }
    const width = style === 'thick' ? 3 : style.startsWith('medium') || style === 'double' ? 2 : 1
    const line = style === 'double' ? 'double' : style.includes('Dash') || style === 'dashed' ? 'dashed' : style === 'dotted' ? 'dotted' : 'solid'
    return `${width}px ${line} ${color(child(node, 'color'))}`
  }
  const css = formats.map(format => {
    const font = fonts[Number(attr(format, 'fontId', '0'))]
    const fill = child(fills[Number(attr(format, 'fillId', '0'))], 'patternFill')
    const edges = borders[Number(attr(format, 'borderId', '0'))]
    const alignment = child(format, 'alignment')
    const horizontal = attr(alignment, 'horizontal')
    const vertical = attr(alignment, 'vertical', 'bottom')
    return {
      fontFamily: `${attr(child(font, 'name'), 'val', 'Arial')}, "Noto Serif CJK SC", serif`,
      fontSize: `${Number(attr(child(font, 'sz'), 'val', '11'))}pt`,
      fontWeight: child(font, 'b') && attr(child(font, 'b'), 'val') !== '0' ? '700' : '400',
      fontStyle: child(font, 'i') ? 'italic' : 'normal',
      textDecoration: child(font, 'u') ? 'underline' : child(font, 'strike') ? 'line-through' : 'none',
      color: color(child(font, 'color')),
      backgroundColor: attr(fill, 'patternType') === 'solid' ? color(child(fill, 'fgColor')) : '#ffffff',
      textAlign: ({ center: 'center', centerContinuous: 'center', right: 'right', left: 'left', justify: 'justify', distributed: 'justify' })[horizontal] || '',
      verticalAlign: vertical === 'center' ? 'middle' : vertical,
      whiteSpace: attr(alignment, 'wrapText') === '1' ? 'pre-wrap' : 'pre',
      borderTop: border(child(edges, 'top')), borderBottom: border(child(edges, 'bottom')),
      borderLeft: border(child(edges, 'left')), borderRight: border(child(edges, 'right'))
    }
  })
  const workbook = await read('xl/workbook.xml')
  const relations = await read('xl/_rels/workbook.xml.rels')
  const targets = new Map([...relations.documentElement.children].map(node => [attr(node, 'Id'), attr(node, 'Target')]))
  const printAreas = new Map([...workbook.getElementsByTagNameNS('*', 'definedName')].filter(node => attr(node, 'name') === '_xlnm.Print_Area').map(node => [Number(attr(node, 'localSheetId')), node.textContent.split('!').pop().replaceAll('$', '')]))
  const sheets = new Map()
  let sheetIndex = 0
  for (const sheet of workbook.getElementsByTagNameNS('*', 'sheet')) {
    const target = targets.get(sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))
    if (!target) { continue }
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const document = await read(path)
    const root = document?.documentElement
    if (!root) { continue }
    const cells = new Map([...root.getElementsByTagNameNS('*', 'c')].map(node => [attr(node, 'r'), Number(attr(node, 's', '0'))]))
    const rows = new Map([...root.getElementsByTagNameNS('*', 'row')].map(node => [Number(attr(node, 'r')) - 1, { height: Number(attr(node, 'ht', '0')), hidden: attr(node, 'hidden') === '1', style: Number(attr(node, 's', '0')) }]))
    const columns = []
    for (const node of root.getElementsByTagNameNS('*', 'col')) {
      for (let index = Number(attr(node, 'min')) - 1; index < Math.min(Number(attr(node, 'max')), 200); index++) {
        columns[index] = { width: Number(attr(node, 'width', '8.43')) * 7 + 5, hidden: attr(node, 'hidden') === '1', style: Number(attr(node, 'style', '0')) }
      }
    }
    const defaults = child(root, 'sheetFormatPr')
    sheets.set(attr(sheet, 'name'), { printArea: printAreas.get(sheetIndex++), cells, rows, columns, defaultHeight: Number(attr(defaults, 'defaultRowHeight', '15')), gridlines: attr(child(child(root, 'sheetViews'), 'sheetView'), 'showGridLines') !== '0' })
  }
  return { css, sheets }
}
