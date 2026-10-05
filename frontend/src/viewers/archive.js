// 压缩包：只读列目录，不自动解压到磁盘，避免路径穿越等风险。
import JSZip from 'jszip'

function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export default async function archive(container, file, helpers) {
  if (file.extension !== 'zip') {
    helpers.report(`压缩包「${file.extension}」暂不支持在线浏览，请下载后解压`)
    const fallback = await import('./download.js')
    return (fallback.default ?? fallback)(container, file, helpers)
  }

  const zip = await JSZip.loadAsync(file.bytes)
  const rows = []
  zip.forEach((path, entry) => {
    rows.push({
      path,
      directory: entry.dir,
      size: entry._data?.uncompressedSize ?? null
    })
  })
  rows.sort((left, right) => left.path.localeCompare(right.path))

  const table = document.createElement('table')
  table.style.cssText = 'border-collapse:collapse;width:100%;font-size:12.5px;background:#fff'
  const header = document.createElement('tr')
  for (const label of ['路径', '大小']) {
    const th = document.createElement('th')
    th.textContent = label
    th.style.cssText = 'border:1px solid #e2e8ee;padding:6px 10px;text-align:left;background:#f4f6f8;position:sticky;top:0'
    header.append(th)
  }
  table.append(header)
  for (const row of rows.slice(0, 5000)) {
    const tr = document.createElement('tr')
    const path = document.createElement('td')
    path.textContent = row.directory ? `${row.path}` : row.path
    path.style.cssText = 'border:1px solid #e2e8ee;padding:5px 10px;font-family:ui-monospace,monospace'
    if (row.directory) path.style.fontWeight = '650'
    const size = document.createElement('td')
    size.textContent = row.directory || row.size == null ? '' : formatBytes(row.size)
    size.style.cssText = 'border:1px solid #e2e8ee;padding:5px 10px;white-space:nowrap;text-align:right'
    tr.append(path, size)
    table.append(tr)
  }
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'padding:16px'
  wrapper.append(table)
  container.replaceChildren(wrapper)
  helpers.report(`共 ${rows.length} 项${rows.length > 5000 ? '（已显示前 5000 项）' : ''}`)
  return undefined
}
