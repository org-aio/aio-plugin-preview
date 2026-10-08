const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 验证真实宿主中的历史持久化，测试仅删除自己创建的记录。
async function run(browser, viewport, label) {
  const base = process.env.AIO_URL
  const context = await browser.newContext({ viewport })
  await context.addCookies([{ name: 'aio_session', value: process.env.AIO_SESSION, domain: new URL(base).hostname, path: '/', httpOnly: true, secure: base.startsWith('https:'), sameSite: 'Lax' }])
  const page = await context.newPage()
  const enter = async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 })
    const nav = page.getByRole('navigation', { name: '场景' })
    await nav.waitFor({ timeout: 120000 })
    await nav.getByRole('button', { name: /工作空间/ }).first().click()
    if (label === 'mobile') {
      const burger = page.getByRole('button', { name: '打开菜单' })
      if (await burger.count()) { await burger.first().click(); await page.waitForTimeout(800) }
    }
    await page.getByRole('button', { name: '文件预览', exact: true }).last().click()
    await page.waitForTimeout(800)
    const frame = page.frameLocator('iframe[title="文件预览"]')
    await frame.locator('#history-panel').waitFor({ state: 'attached', timeout: 120000 })
    await frame.locator('.chip').first().waitFor({state: 'attached', timeout: 120000})
    return frame
  }
  console.log(label + ': enter')
  let frame = await enter()
  console.log(label + ': ready')
  const name = `history-${label}-${Date.now()}.md`
  const file = { name, mimeType: 'text/markdown', buffer: Buffer.from('# 30 天历史验收') }
  await frame.locator('#file-input').setInputFiles(file)
  const entry = () => frame.locator('#history-list').getByRole('button', { name, exact: true })
  await entry().waitFor({ timeout: 60000 }).catch(async error => { console.log(await frame.locator('body').innerText()); await page.screenshot({path: process.env.AIO_TEST_OUTPUT + '/failure.png'}); throw error })
  await frame.locator('#file-input').setInputFiles(file)
  await frame.locator('#history-status').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await entry().count(), 1)
  await frame.getByRole('button', { name: '清空', exact: true }).click()
  assert.equal(await frame.locator('#file-name').textContent(), '')
  assert.equal(await entry().count(), 1)
  frame = await enter()
  await entry().waitFor({ timeout: 60000 }).catch(async error => { console.log(await frame.locator('body').innerText()); await page.screenshot({path: process.env.AIO_TEST_OUTPUT + '/failure.png'}); throw error })
  await entry().click()
  await frame.locator('#stage article h1').filter({ hasText: '30 天历史验收' }).waitFor()
  await frame.getByRole('button', { name: `删除历史 ${name}`, exact: true }).click()
  await frame.locator('#history-delete-dialog').getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await entry().count(), 1)
  await page.screenshot({ path: `${process.env.AIO_TEST_OUTPUT}/${label}.png` })
  await frame.getByRole('button', { name: `删除历史 ${name}`, exact: true }).click()
  await frame.locator('#history-delete-dialog').getByRole('button', { name: '确认删除', exact: true }).click()
  await entry().waitFor({ state: 'detached' })
  assert.equal(await frame.locator('#stage article h1').textContent(), '30 天历史验收')
  frame = await enter()
  await frame.locator('#history-status').filter({ hasText: /失败/ }).count().then(count => assert.equal(count, 0))
  await page.waitForTimeout(1200)
  assert.equal(await entry().count(), 0)
  await context.close()
  return { label, saved: true, deduplicated: true, retainedOnClear: true, reopenedAfterReload: true, deleteCancel: true, deletedAfterReload: true }
}
;(async () => {
  fs.mkdirSync(process.env.AIO_TEST_OUTPUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const results = []
    for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) results.push(await run(browser, viewport, label))
    fs.writeFileSync(`${process.env.AIO_TEST_OUTPUT}/report.json`, JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
