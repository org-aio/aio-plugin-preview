import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import 'highlight.js/styles/github.css'

for (const [name, language] of Object.entries({
  javascript, typescript, json, bash, python, rust, xml, css, sql
})) hljs.registerLanguage(name, language)

// Markdown 渲染结果先经 marked 转义，再交给高亮器，避免直接注入原始 HTML。
// marked v15 已移除旧的 `highlight` 选项，改为覆盖 code 渲染器。
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = lang && hljs.getLanguage(lang) ? lang : null
      let html
      try {
        html = language
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : hljs.highlightAuto(text).value
      } catch {
        html = text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
      }
      return `<pre><code class="hljs${language ? ` language-${language}` : ''}">${html}</code></pre>`
    }
  }
})

export default function markdownViewer(container, file) {
  const source = new TextDecoder('utf-8').decode(file.bytes)
  const article = document.createElement('article')
  article.style.cssText =
    'max-width:900px;margin:0 auto;padding:24px 28px;background:#fff;color:#1f2937;line-height:1.75;font-size:14px'
  article.innerHTML = marked.parse(source)
  for (const table of article.querySelectorAll('table')) {
    table.style.cssText = 'border-collapse:collapse;width:100%;margin:12px 0'
    for (const cell of table.querySelectorAll('th,td')) {
      cell.style.cssText = 'border:1px solid #d7dee5;padding:6px 10px;text-align:left'
    }
  }
  for (const pre of article.querySelectorAll('pre')) {
    pre.style.cssText = 'background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto'
  }
  for (const image of article.querySelectorAll('img')) image.style.maxWidth = '100%'
  container.replaceChildren(article)
  return undefined
}
