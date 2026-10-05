import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDxf } from './dxf.js'
import { renderDatabase } from './dwg-render.js'

// DXF 是成对的『组码 / 值』纯文本；这里用最小组码构造样例。
function dxf(...pairs) {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n'
}

function viewBox(svg) {
  return svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number)
}

const MINIMAL = dxf(
  [0, 'SECTION'], [2, 'ENTITIES'],
  [0, 'LINE'], [8, '0'], [10, '0.0'], [20, '0.0'], [30, '0.0'], [11, '10.0'], [21, '5.0'], [31, '0.0'],
  [0, 'CIRCLE'], [8, '0'], [10, '4.0'], [20, '4.0'], [30, '0.0'], [40, '2.0'],
  [0, 'ENDSEC'], [0, 'EOF']
)

test('parses minimal DXF into renderable geometry', () => {
  const result = renderDatabase(parseDxf(MINIMAL))
  assert.equal(result.entityCount, 2)
  assert.match(result.svg, /<line /)
  assert.match(result.svg, /<circle /)
  // 直线 x 到 10、y 到 5；圆 (4,4) r=2 的 y 到 6。故内容为 10x6，
  // 再加 2% 边距（按较长边 10 计 = 0.2，两侧共 0.4）。
  const box = viewBox(result.svg)
  assert.ok(Math.abs(box[2] - 10.4) < 1e-6, `宽度异常: ${box[2]}`)
  assert.ok(Math.abs(box[3] - 6.4) < 1e-6, `高度异常: ${box[3]}`)
})

test('renders DXF arc from start to end angle in radians', () => {
  // 半径 5、0 -> 90 度的弧（DXF 的 50/51 组码以度给出，dxf-parser 换算成弧度）。
  const arc = dxf(
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'ARC'], [8, '0'], [10, '0.0'], [20, '0.0'], [30, '0.0'], [40, '5.0'], [50, '0.0'], [51, '90.0'],
    [0, 'ENDSEC'], [0, 'EOF']
  )
  const result = renderDatabase(parseDxf(arc))
  assert.equal(result.entityCount, 1)
  // 端点为 (5,0) 与 (0,5)，图幅约为 5x5；若把弧度当角度处理，弧会退化，图幅明显变小。
  const box = viewBox(result.svg)
  assert.ok(box[2] >= 5 && box[2] <= 5.6, `弧宽异常: ${box[2]}`)
  assert.ok(box[3] >= 5 && box[3] <= 5.6, `弧高异常: ${box[3]}`)
  assert.match(result.svg, / A5\.000 /, '应输出半径 5 的圆弧指令')
})

test('expands DXF blocks referenced by INSERT', () => {
  const withBlock = dxf(
    [0, 'SECTION'], [2, 'BLOCKS'],
    [0, 'BLOCK'], [2, 'DOOR'],
    [0, 'LINE'], [8, '0'], [10, '0.0'], [20, '0.0'], [30, '0.0'], [11, '1.0'], [21, '0.0'], [31, '0.0'],
    [0, 'ENDBLK'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'INSERT'], [8, '0'], [2, 'DOOR'], [10, '100.0'], [20, '50.0'], [30, '0.0'],
    [0, 'ENDSEC'], [0, 'EOF']
  )
  const result = renderDatabase(parseDxf(withBlock))
  assert.equal(result.entityCount, 1, '块内实体应被展开绘制')
  const m = result.svg.match(/<line x1="([-\d.]+)" y1="([-\d.]+)"/)
  assert.ok(m, '应输出块内直线')
  assert.ok(Math.abs(Number(m[1]) - 100) < 1e-6 && Math.abs(Number(m[2]) - 50) < 1e-6,
    `插入点应偏移到 (100,50)，实际 (${m[1]},${m[2]})`)
})

// dxf-parser 不解析的实体（如 WIPEOUT、HATCH）在解析阶段就会丢失，
// 因此 DXF 路径只断言它声明支持的类型能进入渲染器。
test('converts every DXF entity type the parser supports', () => {
  const all = dxf(
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LINE'], [8, '0'], [10, '0.0'], [20, '0.0'], [11, '1.0'], [21, '1.0'],
    [0, 'POINT'], [8, '0'], [10, '2.0'], [20, '2.0'],
    [0, 'TEXT'], [8, '0'], [10, '3.0'], [20, '3.0'], [40, '2.5'], [1, 'hi'],
    [0, 'ENDSEC'], [0, 'EOF']
  )
  const database = parseDxf(all)
  assert.deepEqual(database.entities.map((e) => e.type), ['LINE', 'POINT', 'TEXT'])
  const result = renderDatabase(database)
  assert.equal(result.entityCount, 3)
  assert.match(result.svg, /<text /)
})
