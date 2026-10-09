const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 用真实 Chromium 验证编辑、下载、草稿切换、工程模型与清空回归。
async function run(browser, viewport, label) {
  const base = process.env.AIO_URL
  const data = process.env.AIO_TEST_DATA
  const out = process.env.AIO_TEST_OUTPUT
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  if (process.env.AIO_SESSION) {
    await context.addCookies([{ name: 'aio_session', value: process.env.AIO_SESSION, domain: new URL(base).hostname, path: '/', httpOnly: true, secure: base.startsWith('https:'), sameSite: 'Lax' }])
  }
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 })
  let frame = page
  if (process.env.AIO_SESSION) {
    const nav = page.getByRole('navigation', { name: '场景' })
    await nav.waitFor({ timeout: 120000 })
    await nav.getByRole('button', { name: /工作空间/ }).first().click()
    if (label === 'mobile') {
      const burger = page.getByRole('button', { name: '打开菜单' })
      if (await burger.count()) { await burger.first().click(); await page.waitForTimeout(800) }
    }
    await page.getByRole('button', { name: '文件预览', exact: true }).last().click()
    await page.waitForTimeout(800)
    frame = page.frameLocator('iframe[title="文件预览"]')
  }
  console.log(`${label}: waiting for plugin`)
  await frame.locator('.chip').first().waitFor({ state: 'attached', timeout: 120000 })
  console.log(`${label}: opening markdown`)
  await frame.locator('#file-input').setInputFiles([`${data}/fixtures/sample.md`, `${data}/fixtures/cube.stp`])
  await frame.locator('#stage article').waitFor()
  assert.equal(await frame.locator('#file-list .file-row > button:first-child').count(), 2)
  await frame.getByRole('button', { name: '编辑 Markdown', exact: true }).click()
  const source = '# 编辑验收\n\n**草稿保留**\n\n<script>window.__markdownAttack = true</script><img src="x" onerror="window.__markdownAttack=true">'
  await frame.getByRole('textbox', { name: 'Markdown 源码' }).fill(source)
  assert.equal(await frame.locator('#stage article h1').textContent(), '编辑验收')
  assert.equal(await frame.locator('#stage article script, #stage article [onerror]').count(), 0)
  console.log(`${label}: opening STEP`)
  await frame.locator('#file-list').getByRole('button', { name: 'cube.stp', exact: true }).click()
  await frame.locator('#stage canvas').waitFor({ timeout: 120000 })
  await frame.locator('#note').filter({ hasText: /三角面 [1-9]\d*/ }).waitFor()
  const model = await frame.locator('#note').textContent()
  assert.equal(await frame.locator('#error').textContent(), '')
  await page.screenshot({ path: `${out}/${label}-step.png` })
  await frame.locator('#file-list .file-row > button:first-child').filter({ hasText: 'sample.md' }).click()
  await frame.getByRole('button', { name: '编辑 Markdown', exact: true }).click()
  assert.equal(await frame.getByRole('textbox', { name: 'Markdown 源码' }).inputValue(), source)
  await frame.locator('#file-filter').fill('sample')
  assert.equal(await frame.locator('#file-list .file-row > button:first-child').count(), 1)
  await frame.locator('#file-filter').fill('')
  await frame.getByRole('button', { name: '清空', exact: true }).click()
  await frame.getByRole('dialog').waitFor()
  await frame.getByRole('button', { name: '保留草稿', exact: true }).click()
  assert.equal(await frame.getByRole('textbox', { name: 'Markdown 源码' }).inputValue(), source)
  console.log(`${label}: downloading edited markdown`)
  const pending = page.waitForEvent('download')
  await frame.getByRole('button', { name: '下载修改版', exact: true }).click()
  const download = await pending
  assert.equal(download.suggestedFilename(), 'sample-edited.md')
  const output = `${out}/${label}-edited.md`
  await download.saveAs(output)
  assert.equal(fs.readFileSync(output, 'utf8'), source)
  await frame.locator('#file-name').filter({ hasText: 'sample-edited.md' }).waitFor()
  await frame.locator('#stage article h1').filter({ hasText: '编辑验收' }).waitFor()
  const currentDownload = page.waitForEvent('download')
  await frame.locator('#download').click()
  const current = await currentDownload
  await current.saveAs(`${out}/${label}-current.md`)
  assert.equal(fs.readFileSync(`${out}/${label}-current.md`, 'utf8'), source)
  await page.screenshot({ path: `${out}/${label}-markdown.png` })
  // 清空必须同时移除文件名、文件列表及预览内容。
  await frame.getByRole('button', { name: '清空', exact: true }).click()
  assert.equal(await frame.locator('#file-list .file-row > button:first-child').count(), 0)
  assert.equal(await frame.locator('#file-name').textContent(), '')
  assert.equal(await frame.locator('#stage').textContent(), '')
  await frame.locator('#dropzone').waitFor()
  // 文件读取尚未完成时清空，旧任务完成后也不能重新显示文件名或预览。
  await frame.locator('body').evaluate(() => {
    const original = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = function () {
      const file = this
      return new Promise((resolve) => {
        window.__releaseFileRead = async () => {
          File.prototype.arrayBuffer = original
          resolve(await original.call(file))
        }
      })
    }
  })
  await frame.locator('#file-input').setInputFiles(`${data}/fixtures/sample.md`)
  await frame.getByRole('button', { name: '清空', exact: true }).click()
  await frame.locator('body').evaluate(() => window.__releaseFileRead())
  assert.equal(await frame.locator('#file-name').textContent(), '')
  assert.equal(await frame.locator('#file-list .file-row > button:first-child').count(), 0)
  await frame.locator('#dropzone').waitFor()
  // .step 与 .stp 使用同一个真实 STEP 样例；损坏文件后也必须能恢复。
  await frame.locator('#file-input').setInputFiles({ name: 'broken.stp', mimeType: 'application/octet-stream', buffer: Buffer.from('not a model') })
  await frame.locator('#error').filter({ hasText: '解析失败' }).waitFor({ timeout: 120000 })
  await frame.locator('#file-input').setInputFiles({ name: 'cube.step', mimeType: 'application/octet-stream', buffer: fs.readFileSync(`${data}/fixtures/cube.stp`) })
  await frame.locator('#stage canvas').waitFor({ timeout: 120000 })
  assert.equal(await frame.locator('#error').textContent(), '')
  for (const name of ['cube.igs', 'sample.brep']) {
    console.log(`${label}: opening ${name}`)
    await frame.locator('#file-input').setInputFiles(`${data}/fixtures/${name}`)
    await frame.locator('#stage canvas').waitFor({ timeout: 120000 })
    assert.equal(await frame.locator('#error').textContent(), '')
    assert.match(await frame.locator('#note').textContent(), /三角面 [1-9]\d*/)
  }
  await frame.locator('#file-input').setInputFiles(`${data}/dwg/example_2004.dxf`)
  await frame.locator('#stage svg text').first().waitFor({ state: 'attached', timeout: 120000 })
  const originalBox = await frame.locator('#stage svg').getAttribute('viewBox')
  const query = await frame.locator('#stage svg text').first().textContent()
  await frame.getByRole('searchbox', { name: '图纸文字搜索' }).fill(query)
  assert.ok(await frame.locator('.cad-match').count() > 0)
  await frame.getByRole('button', { name: '下一个', exact: true }).click()
  assert.equal(await frame.locator('.cad-active-match').count(), 1)
  assert.notEqual(await frame.locator('#stage svg').getAttribute('viewBox'), originalBox)
  await frame.getByRole('button', { name: '显示全图', exact: true }).click()
  assert.equal(await frame.locator('#stage svg').getAttribute('viewBox'), originalBox)
  await frame.locator('.cad-layers summary').click()
  const checkbox = frame.locator('.cad-layer-choices input').first()
  const layer = (await checkbox.getAttribute('aria-label')).slice(3)
  await checkbox.uncheck()
  const hidden = await frame.locator('#stage svg [data-layer]').evaluateAll((groups, name) => groups.filter((group) => group.getAttribute('data-layer') === name).every((group) => group.style.display === 'none'), layer)
  assert.ok(hidden)
  await checkbox.check()
  await frame.locator('.cad-layers summary').click()
  await page.screenshot({ path: `${out}/${label}-cad.png` })
  // 预期的坏文件会报告解析错误，其他浏览器异常不得出现。
  assert.equal(errors.length, 0, errors.join('\n'))
  await context.close()
  return { label, model, markdownDraft: true, sanitized: true, downloadedBytes: true, reopened: true, multiFile: true, clear: true, stepAndStp: true, iges: true, brep: true, currentFileDownload: true, invalidRecovery: true, cadSearch: true, cadLayers: true, cadFit: true }
}

;(async () => {
  fs.mkdirSync(process.env.AIO_TEST_OUTPUT, { recursive: true })
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const reports = []
    for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      reports.push(await run(browser, viewport, label))
    }
    fs.writeFileSync(path.join(process.env.AIO_TEST_OUTPUT, 'workbench-report.json'), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify(reports, null, 2))
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exit(1) })
