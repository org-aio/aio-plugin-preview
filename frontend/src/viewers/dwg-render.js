// 把 libredwg 转换出的 DwgDatabase 渲染为 SVG。
//
// 为什么不直接用库自带的 dwg_to_svg：它在若干实体（表格、未知类型）上会抛错，
// 一个坏实体就会让整张图空白；对较新的图纸版本还可能中途中断。
// 这里按实体类型逐条转换并对每条单独兜底，保证“能画多少画多少”，
// 并把跳过的实体类型回报给用户。

const MAX_ENTITIES = 200000
const MAX_TEXT = 300

// ---------- 矩阵（仿射，[a b c d e f]）----------
function identity() {
  return [1, 0, 0, 1, 0, 0]
}
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}
function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}
function translation(x, y) {
  return [1, 0, 0, 1, x, y]
}
function scaling(x, y) {
  return [x, 0, 0, y, 0, 0]
}
function rotation(angle) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [cos, sin, -sin, cos, 0, 0]
}
const linearScale = (m) => Math.hypot(m[0], m[1]) || 1

// ---------- 数值 ----------
const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback)
const point = (value) => [num(value?.x), num(value?.y)]

class Box {
  constructor() {
    this.minX = Infinity
    this.minY = Infinity
    this.maxX = -Infinity
    this.maxY = -Infinity
  }
  add(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < this.minX) this.minX = x
    if (y < this.minY) this.minY = y
    if (x > this.maxX) this.maxX = x
    if (y > this.maxY) this.maxY = y
  }
  get empty() {
    return this.minX > this.maxX
  }
}

// ---------- 遍历 ----------
function collect(entities, matrix, box, out, depth, skipped, blocks) {
  if (depth > 16 || out.length >= MAX_ENTITIES) return
  for (const entity of entities ?? []) {
    if (out.length >= MAX_ENTITIES) return
    try {
      visit(entity, matrix, box, out, depth, skipped, blocks)
    } catch {
      skipped.count += 1
    }
  }
}

function visit(entity, matrix, box, out, depth, skipped, blocks) {
  const layer = entity?.layer
  switch (entity?.type) {
    case 'LINE': {
      const a = apply(matrix, ...point(entity.startPoint))
      const b = apply(matrix, ...point(entity.endPoint))
      box.add(...a)
      box.add(...b)
      out.push({ kind: 'line', a, b, layer })
      return
    }
    case 'CIRCLE': {
      const c = apply(matrix, ...point(entity.center))
      const radius = Math.abs(num(entity.radius)) * linearScale(matrix)
      box.add(c[0] - radius, c[1] - radius)
      box.add(c[0] + radius, c[1] + radius)
      out.push({ kind: 'circle', c, radius, layer })
      return
    }
    case 'ARC': {
      const c = apply(matrix, ...point(entity.center))
      const radius = Math.abs(num(entity.radius)) * linearScale(matrix)
      box.add(c[0] - radius, c[1] - radius)
      box.add(c[0] + radius, c[1] + radius)
      out.push({
        kind: 'arc',
        c,
        radius,
        start: num(entity.startAngle),
        end: num(entity.endAngle),
        layer
      })
      return
    }
    case 'ELLIPSE': {
      const c = apply(matrix, ...point(entity.center))
      const major = point(entity.majorAxisEndPoint)
      const radiusX = Math.hypot(major[0], major[1]) * linearScale(matrix)
      const radiusY = radiusX * Math.abs(num(entity.axisRatio, 1))
      const angle = Math.atan2(major[1], major[0])
      box.add(c[0] - radiusX, c[1] - radiusY)
      box.add(c[0] + radiusX, c[1] + radiusY)
      out.push({ kind: 'ellipse', c, radiusX, radiusY, angle, layer })
      return
    }
    case 'LWPOLYLINE': {
      const closed = (num(entity.flag) & 1) === 1
      polyline(transformVertices(entity.vertices, matrix), closed, box, out, layer)
      return
    }
    case 'POLYLINE2D':
    case 'POLYLINE3D': {
      const closed = (num(entity.flag) & 1) === 1
      polyline(transformVertices(entity.vertices, matrix), closed, box, out, layer)
      return
    }
    case 'SPLINE': {
      const source = entity.fitPoints?.length ? entity.fitPoints : entity.controlPoints ?? []
      polyline(source.map((p) => ({ point: apply(matrix, num(p.x), num(p.y)), bulge: 0 })), false, box, out, layer)
      return
    }
    case 'SOLID':
    case '3DFACE': {
      const corners = [entity.corner1, entity.corner2, entity.corner3, entity.corner4]
        .filter(Boolean)
        .map((p) => apply(matrix, ...point(p)))
      if (corners.length < 3) return
      for (const p of corners) box.add(...p)
      out.push({ kind: 'polygon', points: corners, layer })
      return
    }
    case 'POINT': {
      const p = apply(matrix, ...point(entity.position))
      box.add(...p)
      out.push({ kind: 'point', p, layer })
      return
    }
    case 'TEXT':
    case 'ATTRIB':
    case 'ATTDEF': {
      const anchor = entity.startPoint ?? entity.insertionPoint
      const p = apply(matrix, ...point(anchor))
      const raw = String(entity.text ?? entity.defaultValue ?? '').trim()
      if (!raw) {
        skipped.count += 1
        return
      }
      const text = raw.slice(0, MAX_TEXT)
      const height = Math.abs(num(entity.textHeight, 2.5)) * linearScale(matrix)
      const radians = num(entity.rotation)
      box.add(...p)
      box.add(
        p[0] + Math.cos(radians) * height * text.length * 0.65,
        p[1] - Math.sin(radians) * height * text.length * 0.65 - height
      )
      out.push({ kind: 'text', p, height, text, radians, layer })
      return
    }
    case 'MTEXT': {
      const p = apply(matrix, ...point(entity.insertionPoint))
      const text = String(entity.text ?? '')
        .replace(/\\[A-Za-z][^;]*;/g, '')
        .replace(/[{}]/g, '')
        .trim()
        .slice(0, MAX_TEXT)
      if (!text) {
        skipped.count += 1
        return
      }
      const height = Math.abs(num(entity.textHeight, 2.5)) * linearScale(matrix)
      box.add(...p)
      box.add(p[0] + height * text.length * 0.65, p[1] - height * 2)
      out.push({ kind: 'text', p, height, text, radians: num(entity.rotation), layer })
      return
    }
    case 'XLINE':
    case 'RAY': {
      const origin = apply(matrix, ...point(entity.firstPoint))
      const direction = entity.unitDirection ?? { x: 1, y: 0 }
      const hint = apply(matrix, num(direction.x, 1), num(direction.y, 0))
      const base = apply(matrix, 0, 0)
      const dx = hint[0] - base[0]
      const dy = hint[1] - base[1]
      const length = Math.hypot(dx, dy)
      if (length < 1e-9) return
      box.add(...origin)
      out.push({
        kind: 'ray',
        origin,
        dir: [dx / length, dy / length],
        from: entity.type === 'RAY',
        layer
      })
      return
    }
    case 'LEADER': {
      polyline(transformVertices(entity.vertices, matrix), false, box, out, layer)
      return
    }
    case 'MLINE': {
      polyline(transformVertices((entity.vertices ?? []).map((v) => v.vertex), matrix), false, box, out, layer)
      return
    }
    case 'DIMENSION': {
      const a = apply(matrix, ...point(entity.definitionPoint))
      const b = apply(matrix, ...point(entity.textPoint))
      box.add(...a)
      box.add(...b)
      out.push({ kind: 'line', a, b, layer })
      const label = dimensionLabel(entity)
      if (label) {
        const height = 2.5 * linearScale(matrix)
        box.add(b[0] + height * label.length * 0.65, b[1] + height)
        out.push({ kind: 'text', p: b, height, text: label, radians: num(entity.textRotation), layer })
      }
      return
    }
    case 'TOLERANCE': {
      const p = apply(matrix, ...point(entity.insertionPoint))
      const text = String(entity.text ?? '').trim().slice(0, MAX_TEXT)
      if (!text) {
        skipped.count += 1
        return
      }
      const height = 2.5 * linearScale(matrix)
      box.add(...p)
      box.add(p[0] + height * text.length * 0.65, p[1] + height)
      out.push({ kind: 'text', p, height, text, radians: 0, layer })
      return
    }
    case 'HATCH':
    case 'WIPEOUT': {
      const boundaries = entity.boundaryPaths ?? entity.paths ?? []
      for (const boundary of boundaries) {
        const vertices = boundary.vertices
        if (!Array.isArray(vertices) || vertices.length < 3) continue
        const points = vertices.map((v) => apply(matrix, num(v.x), num(v.y)))
        for (const p of points) box.add(...p)
        // 空白擦除用底色填充；填充图案只描边界，避免实心压迫图面。
        if (entity.type === 'WIPEOUT') out.push({ kind: 'wipe', points, layer })
        else out.push({ kind: 'polygon', points, layer, outlineOnly: true })
      }
      return
    }
    case 'SHAPE': {
      const p = apply(matrix, ...point(entity.insertionPoint))
      const size = Math.abs(num(entity.size, 1)) * linearScale(matrix)
      box.add(p[0] - size, p[1] - size)
      box.add(p[0] + size, p[1] + size)
      out.push({ kind: 'circle', c: p, radius: size / 2, layer, faint: true })
      return
    }
    case 'INSERT': {
      // 块内实体保存在 BLOCK_RECORD，按 INSERT 的块名查表。
      const children = blocks?.get(entity.name) ?? entity.entities
      const insertion = point(entity.insertionPoint)
      const local = multiply(
        matrix,
        multiply(
          translation(insertion[0], insertion[1]),
          multiply(rotation(num(entity.rotation)), scaling(num(entity.xScale, 1), num(entity.yScale, 1)))
        )
      )
      if (Array.isArray(children)) collect(children, local, box, out, depth + 1, skipped, blocks)
      else {
        skipped.count += 1
        skipped.types.add(`INSERT:${entity.name ?? '?'}`)
      }
      return
    }
    default: {
      skipped.count += 1
      skipped.types.add(entity?.type ?? 'unknown')
    }
  }
}

function transformVertices(vertices, matrix) {
  return (vertices ?? []).map((vertex) => ({
    point: apply(matrix, num(vertex.x), num(vertex.y)),
    bulge: num(vertex.bulge)
  }))
}

function polyline(vertices, closed, box, out, layer) {
  if (!vertices.length) return
  for (const vertex of vertices) box.add(...vertex.point)
  if (vertices.length === 1) {
    out.push({ kind: 'point', p: vertices[0].point, layer })
    return
  }
  out.push({ kind: 'polyline', vertices, closed, layer })
}

function dimensionLabel(entity) {
  const text = typeof entity.text === 'string' ? entity.text.trim() : ''
  if (text && text !== '<>') return text.slice(0, 60)
  const measurement = Number(entity.measurement)
  return Number.isFinite(measurement) ? measurement.toFixed(2) : ''
}

// ---------- SVG 输出 ----------
const STROKE = '#2b3a45'

function escape(value) {
  return String(value).replace(/[<>&]/g, (character) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[character]
  ))
}

function fixed(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '0'
}

// DWG 角度逆时针，SVG 的 y 轴向下，因此按数学坐标反向取弧。
function arcPath(c, radius, startDegrees, endDegrees) {
  const start = (((endDegrees % 360) + 360) % 360)
  const end = (((startDegrees % 360) + 360) % 360)
  let sweep = end - start
  if (sweep < 0) sweep += 360
  const at = (degrees) => {
    const radians = (degrees * Math.PI) / 180
    return [c[0] + radius * Math.cos(radians), c[1] - radius * Math.sin(radians)]
  }
  const from = at(start)
  const to = at(start + sweep)
  const large = sweep > 180 ? 1 : 0
  return `M${fixed(from[0])} ${fixed(from[1])} A${fixed(radius)} ${fixed(radius)} 0 ${large} 1 ${fixed(to[0])} ${fixed(to[1])}`
}

// bulge = tan(θ/4)，正值表示 WCS 逆时针。
function bulgeSegment(from, to, bulge) {
  const theta = 4 * Math.atan(bulge)
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1])
  if (!(Math.abs(theta) > 1e-6) || chord < 1e-9) return `L${fixed(to[0])} ${fixed(to[1])}`
  const radius = chord / (2 * Math.sin(theta / 2))
  const large = Math.abs(theta) > Math.PI ? 1 : 0
  const sweep = bulge > 0 ? 0 : 1
  return `A${fixed(Math.abs(radius))} ${fixed(Math.abs(radius))} 0 ${large} ${sweep} ${fixed(to[0])} ${fixed(to[1])}`
}

function polylinePath(vertices, closed) {
  let path = `M${fixed(vertices[0].point[0])} ${fixed(vertices[0].point[1])}`
  for (let index = 1; index < vertices.length; index += 1) {
    path += ` ${bulgeSegment(vertices[index - 1].point, vertices[index].point, vertices[index - 1].bulge)}`
  }
  if (closed) {
    const last = vertices[vertices.length - 1]
    path += ` ${bulgeSegment(last.point, vertices[0].point, last.bulge)} Z`
  }
  return path
}

function draw(entity, span) {
  switch (entity.kind) {
    case 'line':
      return `<line x1="${fixed(entity.a[0])}" y1="${fixed(entity.a[1])}" x2="${fixed(entity.b[0])}" y2="${fixed(entity.b[1])}"/>`
    case 'circle':
      return `<circle cx="${fixed(entity.c[0])}" cy="${fixed(entity.c[1])}" r="${fixed(entity.radius)}" fill="none"${entity.faint ? ' stroke-opacity=".4"' : ''}/>`
    case 'arc':
      return `<path d="${arcPath(entity.c, entity.radius, entity.start, entity.end)}" fill="none"/>`
    case 'ellipse': {
      const degrees = (entity.angle * 180) / Math.PI
      return `<ellipse cx="${fixed(entity.c[0])}" cy="${fixed(entity.c[1])}" rx="${fixed(entity.radiusX)}" ry="${fixed(entity.radiusY)}" fill="none" transform="rotate(${degrees.toFixed(3)} ${fixed(entity.c[0])} ${fixed(entity.c[1])})"/>`
    }
    case 'polyline':
      return `<path d="${polylinePath(entity.vertices, entity.closed)}" fill="none"/>`
    case 'polygon': {
      const path = entity.points.map((p, index) => `${index ? 'L' : 'M'}${fixed(p[0])} ${fixed(p[1])}`).join(' ') + ' Z'
      return `<path d="${path}" fill="none"/>`
    }
    case 'wipe': {
      const path = entity.points.map((p, index) => `${index ? 'L' : 'M'}${fixed(p[0])} ${fixed(p[1])}`).join(' ') + ' Z'
      return `<path d="${path}" fill="#ffffff" stroke="none"/>`
    }
    case 'point':
      return `<circle cx="${fixed(entity.p[0])}" cy="${fixed(entity.p[1])}" r="0.6" fill="${STROKE}"/>`
    case 'text': {
      const degrees = (entity.radians * 180) / Math.PI
      const transform = degrees ? ` transform="rotate(${degrees.toFixed(3)} ${fixed(entity.p[0])} ${fixed(entity.p[1])})"` : ''
      return `<text x="${fixed(entity.p[0])}" y="${fixed(entity.p[1])}" font-size="${fixed(entity.height)}" fill="${STROKE}"${transform}>${escape(entity.text)}</text>`
    }
    case 'ray': {
      const [dx, dy] = entity.dir
      const start = entity.from
        ? entity.origin
        : [entity.origin[0] - dx * span, entity.origin[1] - dy * span]
      const end = [entity.origin[0] + dx * span, entity.origin[1] + dy * span]
      return `<line x1="${fixed(start[0])}" y1="${fixed(start[1])}" x2="${fixed(end[0])}" y2="${fixed(end[1])}" stroke-opacity=".5"/>`
    }
    default:
      return ''
  }
}

/**
 * 渲染数据库为 SVG。
 * @returns {{svg: string, entityCount: number, skipped: number, skippedTypes: string[]}}
 */
export function renderDatabase(database) {
  const box = new Box()
  const entities = []
  const skipped = { count: 0, types: new Set() }

  // 命名块表供 INSERT 展开；模型空间/图纸空间自身不是可插入块。
  const blocks = new Map()
  for (const record of database.tables?.BLOCK_RECORD?.entries ?? []) {
    if (record?.name && !record.name.startsWith('*') && Array.isArray(record.entities)) {
      blocks.set(record.name, record.entities)
    }
  }

  // 模型空间是图纸正文；顶层 entities 可能只包含部分内容。
  const modelSpace = (database.tables?.BLOCK_RECORD?.entries ?? [])
    .find((record) => record.name === '*Model_Space')
  const source = modelSpace?.entities?.length ? modelSpace.entities : database.entities ?? []
  collect(source, identity(), box, entities, 0, skipped, blocks)

  if (box.empty) throw new Error('图纸不含可显示的实体')

  const width = Math.max(box.maxX - box.minX, 1e-6)
  const height = Math.max(box.maxY - box.minY, 1e-6)
  const margin = Math.max(width, height) * 0.02
  const minX = box.minX - margin
  const minY = -box.maxY - margin
  const totalWidth = width + margin * 2
  const totalHeight = height + margin * 2
  const span = Math.hypot(width, height) * 2 || 1000

  const body = entities.map((entity) => draw(entity, span)).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fixed(minX)} ${fixed(minY)} ${fixed(totalWidth)} ${fixed(totalHeight)}" ` +
    `width="${fixed(totalWidth)}" height="${fixed(totalHeight)}" ` +
    `stroke="${STROKE}" stroke-width="${fixed(Math.max(width, height) / 1800)}" ` +
    `stroke-linecap="round" stroke-linejoin="round" font-family="sans-serif">` +
    `<rect x="${fixed(minX)}" y="${fixed(minY)}" width="${fixed(totalWidth)}" height="${fixed(totalHeight)}" fill="#ffffff" stroke="none"/>` +
    body +
    '</svg>'

  return {
    svg,
    entityCount: entities.length,
    skipped: skipped.count,
    skippedTypes: [...skipped.types].slice(0, 12)
  }
}
