// PDF：PDF.js 在主线程解析（“fake worker”模式）。
//
// 为什么不用独立 Worker：AIO 隔离页面用沙箱 iframe + CSP `worker-src blob:`，
// 自建 blob Worker 会把 PDF.js 的模块地址重定向，而 PDF.js 的 worker 包在
// 模块 Worker 内无法再走宿主资源桥。改为把官方 worker 包作为普通模块引入并
// 挂到 `globalThis.pdfjsWorker`，PDF.js 会自动使用同线程处理器，行为一致且
// 不依赖 `worker-src`。
import * as pdfjs from 'pdfjs-dist'
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs'

globalThis.pdfjsWorker = pdfjsWorker

export default async function pdf(container, file, helpers) {
  const document_ = await pdfjs.getDocument({ data: file.bytes, isEvalSupported: false }).promise
  const wrapper = document.createElement('div')
  wrapper.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;background:#eef2f5;min-height:100%'
  container.replaceChildren(wrapper)

  let disposed = false
  const width = Math.min(container.clientWidth - 48 || 900, 1200)
  const scale = Math.max(0.2, width / 794)

  for (let number = 1; number <= document_.numPages; number += 1) {
    if (disposed) break
    const page = await document_.getPage(number)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.cssText = 'max-width:100%;height:auto;background:#fff;box-shadow:0 1px 4px #0f172a1f'
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    wrapper.append(canvas)
  }
  helpers.report(`共 ${document_.numPages} 页`)
  return () => {
    disposed = true
    void document_.destroy()
  }
}
