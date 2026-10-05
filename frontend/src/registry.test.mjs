import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extensionOf, FALLBACK_FORMATS, tableFrom } from './registry.js'

test('extracts lowercase extensions from paths', () => {
  assert.equal(extensionOf('Plan.DWG'), 'dwg')
  assert.equal(extensionOf('/a/b/robot.STL'), 'stl')
  assert.equal(extensionOf('C:\\docs\\report.PDF'), 'pdf')
})

test('returns empty extension for names without a usable suffix', () => {
  assert.equal(extensionOf('Makefile'), '')
  assert.equal(extensionOf('archive.'), '')
  assert.equal(extensionOf('.gitignore'), '')
  assert.equal(extensionOf(''), '')
})

test('builds an extension lookup table from the backend format list', () => {
  const table = tableFrom([
    { renderer: 'dwg', extensions: ['dwg', 'dxf'] },
    { renderer: 'model', extensions: ['glb', 'stl'] }
  ])
  assert.equal(table.get('dwg'), 'dwg')
  assert.equal(table.get('dxf'), 'dwg')
  assert.equal(table.get('stl'), 'model')
  assert.equal(table.get('unknown'), undefined)
})

test('fallback formats cover every renderer and stay consistent', () => {
  const renderers = new Set(FALLBACK_FORMATS.map((format) => format.renderer))
  for (const renderer of ['image', 'pdf', 'video', 'audio', 'markdown', 'docx', 'xlsx', 'dwg', 'model', 'archive', 'text']) {
    assert.ok(renderers.has(renderer), `缺少渲染器声明: ${renderer}`)
  }
  const table = tableFrom(FALLBACK_FORMATS)
  // 每个扩展名只能映射到一个渲染器，避免前端与后端判定漂移。
  const seen = new Set()
  for (const format of FALLBACK_FORMATS) {
    for (const extension of format.extensions) {
      assert.ok(!seen.has(extension), `扩展名重复声明: ${extension}`)
      seen.add(extension)
      assert.equal(table.get(extension), format.renderer)
    }
  }
})
