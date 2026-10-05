// DXF 解析适配器。
//
// 为什么不用 libredwg 读 DXF：随包发布的 libredwg WebAssembly 构建只编译了
// DWG 读取（`dwg_read_data` 对 DXF 始终返回空指针，最小合法 DXF 也一样），
// 而 DXF 是公开的文本格式，用 dxf-parser 直接解析更可靠。
// 这里把它的输出归一成与 libredwg 相同的 DwgDatabase 形状，复用同一套渲染器。
//
// 覆盖范围：dxf-parser 只解析 LINE、CIRCLE、ARC、ELLIPSE、LWPOLYLINE、POLYLINE、
// SPLINE、TEXT、MTEXT、ATTDEF、INSERT、POINT、SOLID、3DFACE、DIMENSION、VERTEX，
// 其它类型（HATCH、WIPEOUT、XLINE、RAY、MLINE 等）会在解析阶段被丢弃，
// 因此 DXF 的实体覆盖少于 DWG 路径。

import DxfParser from 'dxf-parser'

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback)
const point = (value) => ({ x: num(value?.x), y: num(value?.y), z: num(value?.z) })

/** 把 DXF 文本解析成渲染器可用的数据库结构。 */
export function parseDxf(source) {
  const dxf = new DxfParser().parse(source)
  const blocks = new Map()
  for (const [name, block] of Object.entries(dxf.blocks ?? {})) {
    if (Array.isArray(block?.entities) && block.entities.length) {
      blocks.set(name, block.entities)
    }
  }

  const modelSpace = dxf.blocks?.['*Model_Space']?.entities ?? []
  const source_ = modelSpace.length ? modelSpace : dxf.entities ?? []
  const entities = source_.map((entity) => convert(entity, blocks)).filter(Boolean)

  const layers = new Map()
  for (const table of Object.values(dxf.tables?.layer?.layers ?? {})) {
    if (table?.name) layers.set(table.name, { name: table.name })
  }

  return {
    header: {},
    entities,
    tables: {
      LAYER: { entries: [...layers.values()] },
      BLOCK_RECORD: {
        entries: [
          { name: '*Model_Space', entities },
          ...[...blocks.entries()].map(([name, items]) => ({
            name,
            entities: items.map((entity) => convert(entity, blocks)).filter(Boolean)
          }))
        ]
      }
    }
  }
}

// INSERT 展开交给渲染器：它按 blocks 表查名，这里把块表挂到根节点上。
function convert(entity, blocks) {
  const type = entity?.type
  if (!type) return null
  const base = { layer: entity.layer, type: normalizeType(type), name: entity.name }
  switch (type) {
    case 'LINE': {
      const [start, end] = entity.vertices ?? []
      if (!start || !end) return null
      return { ...base, startPoint: point(start), endPoint: point(end) }
    }
    case 'CIRCLE':
      return { ...base, center: point(entity.center), radius: num(entity.radius) }
    case 'ARC': {
      // dxf-parser 把 DXF 的角度统一换算成弧度，与本渲染器的通用约定一致，直接透传。
      const start = num(entity.startAngle)
      const end = Number.isFinite(entity.angleLength)
        ? start + entity.angleLength
        : num(entity.endAngle)
      return { ...base, center: point(entity.center), radius: num(entity.radius), startAngle: start, endAngle: end }
    }
    case 'ELLIPSE':
      return {
        ...base,
        center: point(entity.center),
        majorAxisEndPoint: point(entity.majorAxisEndPoint),
        axisRatio: num(entity.axisRatio, 1)
      }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = (entity.vertices ?? []).filter((v) => Number.isFinite(v?.x) && Number.isFinite(v?.y))
      if (!vertices.length) return null
      return {
        ...base,
        type: 'LWPOLYLINE',
        flag: entity.shape ? 1 : 0,
        vertices: vertices.map((v) => ({ x: num(v.x), y: num(v.y), bulge: num(v.bulge) }))
      }
    }
    case 'SPLINE': {
      const points = entity.fitPoints?.length ? entity.fitPoints : entity.controlPoints ?? []
      return { ...base, type: 'SPLINE', fitPoints: points.map(point), controlPoints: [] }
    }
    case 'TEXT':
    case 'ATTRIB':
    case 'ATTDEF':
      return {
        ...base,
        startPoint: point(entity.startPoint),
        textHeight: num(entity.textHeight, 2.5),
        text: String(entity.text ?? ''),
        rotation: num(entity.rotation)
      }
    case 'MTEXT': {
      // DXF 用 \P 表示换行，渲染器只画单行时先转成换行符交由文本处理。
      const text = String(entity.text ?? '').replace(/\\P/gi, '\n')
      return {
        ...base,
        type: 'MTEXT',
        insertionPoint: point(entity.position),
        textHeight: num(entity.height, 2.5),
        text,
        rotation: num(entity.rotation)
      }
    }
    case 'INSERT': {
      return {
        ...base,
        insertionPoint: point(entity.position),
        xScale: num(entity.xScale, 1),
        yScale: num(entity.yScale, 1),
        rotation: num(entity.rotation)
      }
    }
    case 'POINT':
      return { ...base, position: point(entity.position) }
    case 'SOLID': {
      const corners = (entity.points ?? []).map(point)
      if (corners.length < 3) return null
      return { ...base, corner1: corners[0], corner2: corners[1], corner3: corners[2], corner4: corners[3] }
    }
    case '3DFACE': {
      const corners = (entity.vertices ?? entity.points ?? []).map(point)
      if (corners.length < 3) return null
      return { ...base, corner1: corners[0], corner2: corners[1], corner3: corners[2], corner4: corners[3] }
    }
    case 'DIMENSION': {
      const label = String(entity.text ?? '').trim()
      const measurement = Number(entity.actualMeasurement)
      return {
        ...base,
        definitionPoint: point(entity.anchorPoint),
        textPoint: point(entity.middleOfText ?? entity.anchorPoint),
        text: label && label !== '<>' ? label : '',
        measurement: Number.isFinite(measurement) ? measurement : undefined
      }
    }
    default:
      // 其它实体交给渲染器按类型名统计并跳过。
      return { ...base }
  }
}

function normalizeType(type) {
  if (type === 'POLYLINE') return 'LWPOLYLINE'
  return type
}
