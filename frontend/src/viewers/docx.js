// Word：docx-preview 在浏览器内解析 OOXML 并渲染为 HTML。
import { renderAsync } from 'docx-preview'

export default async function docx(container, file, helpers) {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'padding:20px;background:#eef2f5'
  const page = document.createElement('div')
  page.style.cssText = 'max-width:900px;margin:0 auto;background:#fff;padding:28px;box-shadow:0 1px 4px #0f172a1f'
  wrapper.append(page)
  container.replaceChildren(wrapper)

  try {
    await renderAsync(file.bytes.buffer, page, undefined, {
      className: 'docx',
      inWrapper: false,
      ignoreWidth: false,
      ignoreHeight: true,
      breakPages: true
    })
  } catch (error) {
    throw new Error(`Word 文档解析失败：${error?.message ?? error}`)
  }
  return undefined
}
