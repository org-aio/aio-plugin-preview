// 图层开关、文字搜索和定位都操作现有 SVG，不重新解析图纸。
export function cadTools(svg, navigation) {
  const toolbar = document.createElement('div')
  toolbar.className = 'viewer-toolbar'
  const originalBox = svg.getAttribute('viewBox')
  const fit = document.createElement('button')
  fit.type = 'button'
  fit.textContent = '显示全图'
  fit.addEventListener('click', () => {
    navigation.reset()
    svg.setAttribute('viewBox', originalBox)
  })
  const search = document.createElement('input')
  search.type = 'search'
  search.placeholder = '找文字或数字…'
  search.setAttribute('aria-label', '图纸文字搜索')
  const next = document.createElement('button')
  next.type = 'button'
  next.textContent = '下一个'
  const count = document.createElement('span')
  count.className = 'file-meta'
  let matches = []
  let position = -1
  const texts = [...svg.querySelectorAll('text')]
  const update = () => {
    for (const text of texts) { text.classList.remove('cad-match', 'cad-active-match') }
    const query = search.value.trim().toLocaleLowerCase()
    matches = query ? texts.filter((text) => text.textContent.toLocaleLowerCase().includes(query) && text.parentElement.style.display !== 'none') : []
    position = -1
    for (const text of matches) { text.classList.add('cad-match') }
    count.textContent = query ? `找到 ${matches.length} 处` : ''
  }
  const locateNext = () => {
    if (!matches.length) { return }
    for (const text of matches) { text.classList.remove('cad-active-match') }
    position = (position + 1) % matches.length
    const text = matches[position]
    text.classList.add('cad-active-match')
    const box = text.getBBox()
    const matrix = text.transform.baseVal.consolidate()?.matrix
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
      .map(([x, y]) => matrix ? new DOMPoint(x, y).matrixTransform(matrix) : { x, y })
    const x = Math.min(...corners.map((point) => point.x))
    const y = Math.min(...corners.map((point) => point.y))
    const width = Math.max(box.width * 4, box.height * 12, 1)
    const height = Math.max(width * svg.clientHeight / (svg.clientWidth || 1), box.height * 6)
    navigation.reset()
    svg.setAttribute('viewBox', `${x + box.width / 2 - width / 2} ${y + box.height / 2 - height / 2} ${width} ${height}`)
    count.textContent = `${position + 1} / ${matches.length}`
  }
  search.addEventListener('input', update)
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); locateNext() }
  })
  next.addEventListener('click', locateNext)
  const layers = document.createElement('details')
  layers.className = 'cad-layers'
  const summary = document.createElement('summary')
  const groups = [...svg.querySelectorAll('[data-layer]')]
  const names = [...new Set(groups.map((group) => group.getAttribute('data-layer')))].sort()
  summary.textContent = `图层：${names.length}`
  const choices = document.createElement('div')
  choices.className = 'cad-layer-choices'
  for (const name of names) {
    const label = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    checkbox.setAttribute('aria-label', `图层 ${name}`)
    checkbox.addEventListener('change', () => {
      for (const group of groups.filter((group) => group.getAttribute('data-layer') === name)) {
        group.style.display = checkbox.checked ? '' : 'none'
      }
      update()
    })
    label.append(checkbox, document.createTextNode(name))
    choices.append(label)
  }
  layers.append(summary, choices)
  toolbar.append(fit, layers, search, next, count)
  return toolbar
}
