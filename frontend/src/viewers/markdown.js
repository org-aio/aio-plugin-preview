import DOMPurify from 'dompurify'
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

// Markdown 支持原始 HTML，渲染后用 DOMPurify 清理，再放入页面。
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

export default function markdownViewer(container, file, helpers) {
  const source = new TextDecoder('utf-8').decode(file.bytes)
  const wrapper = document.createElement('div')
  wrapper.className = 'markdown-workbench'
  const toolbar = document.createElement('div')
  toolbar.className = 'viewer-toolbar'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.textContent = '编辑 Markdown'
  toggle.setAttribute('aria-pressed', 'false')
  const save = document.createElement('button')
  save.type = 'button'
  save.textContent = '下载修改版'
  const status = document.createElement('span')
  status.className = 'file-meta'
  const body = document.createElement('div')
  body.className = 'markdown-body'
  const editor = document.createElement('textarea')
  editor.setAttribute('aria-label', 'Markdown 源码')
  editor.spellcheck = false
  editor.value = source
  editor.hidden = true
  const article = document.createElement('article')
  article.className = 'markdown-preview'
  const render = () => {
    article.innerHTML = DOMPurify.sanitize(marked.parse(editor.value))
    for (const link of article.querySelectorAll('a')) {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    }
  }
  toggle.addEventListener('click', () => {
    editor.hidden = !editor.hidden
    body.classList.toggle('editing', !editor.hidden)
    toggle.setAttribute('aria-pressed', String(!editor.hidden))
    toggle.textContent = editor.hidden ? '编辑 Markdown' : '只看预览'
    if (!editor.hidden) { editor.focus() }
  })
  editor.addEventListener('input', () => {
    helpers.updateDraft(editor.value)
    status.textContent = '草稿已保留 · 未下载'
    render()
  })
  save.addEventListener('click', () => {
    helpers.exportFile(file.name, editor.value, 'text/markdown;charset=utf-8')
  })
  toolbar.append(toggle, save, status)
  body.append(editor, article)
  wrapper.append(toolbar, body)
  render()
  container.replaceChildren(wrapper)
}
