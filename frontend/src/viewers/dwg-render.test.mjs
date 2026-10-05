import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDatabase } from './dwg-render.js'

// 构造最小数据库：模型空间含少量实体 + 一个被 INSERT 引用的命名块。
function database(entities, blockEntities = []) {
  return {
    entities: [],
    tables: {
      LAYER: { entries: [{ name: '0' }] },
      BLOCK_RECORD: {
        entries: [
          { name: '*Model_Space', entities },
          ...(blockEntities.length ? [{ name: 'DOOR', entities: blockEntities }] : [])
        ]
      }
    }
  }
}

test('renders model space geometry and reports entity count', () => {
  const result = renderDatabase(database([
    { type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 5 } },
    { type: 'CIRCLE', layer: '0', center: { x: 4, y: 4 }, radius: 2 },
    { type: 'ARC', layer: '0', center: { x: 0, y: 0 }, radius: 3, startAngle: 0, endAngle: 1.5 }
  ]))
  assert.equal(result.entityCount, 3)
  assert.equal(result.skipped, 0)
  assert.match(result.svg, /^<svg /)
  assert.match(result.svg, /<line /)
  assert.match(result.svg, /<circle /)
  assert.match(result.svg, /<path /)
})

test('expands blocks referenced by INSERT and applies rotation and scale', () => {
  const result = renderDatabase(
    database([{ type: 'INSERT', layer: '0', name: 'DOOR', insertionPoint: { x: 100, y: 50 }, xScale: 2, yScale: 2, rotation: 1.5707963267948966 }],
      [{ type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } }])
  )
  assert.equal(result.entityCount, 1)
  assert.equal(result.skipped, 0)
  // 旋转 90° 并缩放 2 倍后，(0,0)→(1,0) 变为 (100,50)→(100,52)。
  const match = result.svg.match(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/)
  assert.ok(match, '应输出一条直线')
  assert.ok(Math.abs(Number(match[1]) - 100) < 1e-3, match[1])
  assert.ok(Math.abs(Number(match[2]) - 50) < 1e-3, match[2])
  assert.ok(Math.abs(Number(match[3]) - 100) < 1e-3, match[3])
  assert.ok(Math.abs(Number(match[4]) - 52) < 1e-3, match[4])
})

test('keeps drawing when an unknown entity type appears', () => {
  const result = renderDatabase(database([
    { type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } },
    { type: 'ACAD_TABLE', layer: '0' },
    { type: 'LINE', layer: '0', startPoint: { x: 0, y: 1 }, endPoint: { x: 1, y: 1 } }
  ]))
  assert.equal(result.entityCount, 2, '坏实体不应影响其余实体')
  assert.equal(result.skipped, 1)
  assert.deepEqual(result.skippedTypes, ['ACAD_TABLE'])
})

test('tolerates entities with missing or non-finite coordinates', () => {
  const result = renderDatabase(database([
    { type: 'LINE', layer: '0', startPoint: { x: NaN, y: 0 }, endPoint: null },
    { type: 'CIRCLE', layer: '0', center: {}, radius: undefined },
    { type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 3, y: 3 } }
  ]))
  assert.ok(result.entityCount >= 1)
  assert.doesNotMatch(result.svg, /NaN|Infinity/)
})

test('escapes text and rejects drawings without visible geometry', () => {
  const result = renderDatabase(database([
    { type: 'TEXT', layer: '0', startPoint: { x: 0, y: 0 }, text: '<A&B>', textHeight: 2.5 }
  ]))
  assert.match(result.svg, /&lt;A&amp;B&gt;/)
  assert.doesNotMatch(result.svg, /<A&B>/)

  assert.throws(() => renderDatabase(database([])), /不含可显示的实体/)
})

test('renders bulged polyline segments as arcs', () => {
  const result = renderDatabase(database([
    {
      type: 'LWPOLYLINE',
      layer: '0',
      flag: 0,
      vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 0 }]
    }
  ]))
  assert.match(result.svg, / A[-\d.]+/)
})
