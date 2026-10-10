const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 使用用户提供的模板核对样式，不将私有模板写入仓库。
;(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const base = process.env.AIO_URL
    if (process.env.AIO_SESSION) {
      await page.context().addCookies([{ name: 'aio_session', value: process.env.AIO_SESSION, domain: new URL(base).hostname, path: '/', secure: base.startsWith('https:'), httpOnly: true, sameSite: 'Lax' }])
    }
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 })
    let frame = page
    if (process.env.AIO_SESSION) {
      await page.getByRole('navigation', { name: '场景' }).getByRole('button', { name: /工作空间/ }).first().click()
      await page.getByRole('button', { name: '文件预览', exact: true }).last().click()
      await page.waitForTimeout(800)
      frame = page.frameLocator('iframe[title="文件预览"]')
    }
    await frame.locator('.chip').first().waitFor({ state: 'attached', timeout: 120000 })
    await frame.locator('#file-input').setInputFiles(process.env.AIO_TEST_FILE)
    await frame.locator('.spreadsheet-table').waitFor()
    const tabs = ['报审表', '见证记录-试块', '见证记录-原材类', '见证记录-现场检测', '委托单模板']
    const reports = []
    for (const name of tabs) {
      await frame.locator('#stage').getByRole('button', { name, exact: true }).click()
      const result = await frame.locator('.spreadsheet-table').evaluate(table => ({
        merged: table.querySelectorAll('td[colspan],td[rowspan]').length,
        rows: table.querySelectorAll('tr').length,
        columns: table.querySelectorAll('col').length,
        width: table.getBoundingClientRect().width,
        title: table.querySelector('[data-cell="A1"]')?.textContent,
        titleStyle: table.querySelector('[data-cell="A1"]')?.getAttribute('style')
      }))
      assert.ok(result.merged > 0, name)
      reports.push({ name, ...result })
    }
    await frame.locator('#stage').getByRole('button', { name: '见证记录-现场检测', exact: true }).click()
    assert.equal(await frame.locator('.spreadsheet-table col').count(), 30)
    await frame.getByRole('button', { name: '查看完整工作表', exact: true }).click()
    assert.equal(await frame.locator('.spreadsheet-table col').count(), 35)
    await frame.getByRole('button', { name: '仅显示打印区域', exact: true }).click()
    await frame.getByRole('button', { name: '原始大小', exact: true }).click()
    assert.equal(await frame.locator('.spreadsheet-table').evaluate(table => table.style.transform), 'scale(1)')
    await frame.getByRole('button', { name: '适应宽度', exact: true }).click()
    const title = frame.locator('[data-cell="A1"]')
    assert.equal(await title.getAttribute('colspan'), '30')
    assert.equal(await title.getAttribute('rowspan'), '2')
    const layout = await frame.locator('.spreadsheet-table').evaluate(table => ({
      title: getComputedStyle(table.querySelector('[data-cell="A1"]')).fontSize,
      alignment: getComputedStyle(table.querySelector('[data-cell="A1"]')).textAlign,
      firstWidth: table.querySelector('col').style.width,
      firstHeight: table.querySelector('tr').style.height
    }))
    assert.equal(layout.alignment, 'center')
    assert.equal(layout.firstHeight, '13.5pt')
    assert.ok(parseFloat(layout.firstWidth) < 30)
    assert.ok(parseFloat(layout.title) >= 24)
    assert.equal(errors.length, 0, errors.join('\n'))
    fs.mkdirSync(process.env.AIO_TEST_OUTPUT, { recursive: true })
    await page.screenshot({ path: `${process.env.AIO_TEST_OUTPUT}/template.png`, fullPage: true })
    fs.writeFileSync(`${process.env.AIO_TEST_OUTPUT}/report.json`, JSON.stringify({ reports, layout }, null, 2))
    console.log(JSON.stringify({ reports, layout }))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
