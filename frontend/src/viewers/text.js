import hljs from 'highlight.js/lib/core'
import plaintext from 'highlight.js/lib/languages/plaintext'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import ini from 'highlight.js/lib/languages/ini'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import kotlin from 'highlight.js/lib/languages/kotlin'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import 'highlight.js/styles/github.css'

// 只注册用得到的语言，避免把全部语法打进包。
const LANGUAGES = {
  plaintext, json, xml, yaml, ini, bash, python, rust, go, java, kotlin,
  c, cpp, csharp, javascript, typescript, css, sql, markdown
}
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language)

const EXTENSIONS = {
  json: 'json', xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', env: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  css: 'css', scss: 'css', less: 'css',
  sql: 'sql', md: 'markdown', markdown: 'markdown', mdx: 'markdown'
}

// 超过 2 MiB 只做纯文本，避免高亮卡顿。
const HIGHLIGHT_LIMIT = 2 * 1024 * 1024

function decode(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 非 UTF-8（常见于 GBK/ANSI）时用宽松解码，保证不丢内容。
    return new TextDecoder('utf-8').decode(bytes)
  }
}

export default function text(container, file, helpers) {
  const source = decode(file.bytes)
  const pre = document.createElement('pre')
  pre.style.cssText = 'margin:0;padding:16px;overflow:auto;font-size:13px;line-height:1.6'
  const code = document.createElement('code')
  code.textContent = source
  pre.append(code)
  container.replaceChildren(pre)

  if (file.bytes.byteLength <= HIGHLIGHT_LIMIT && source.length) {
    const language = file.name === 'Dockerfile' || file.name === 'Makefile'
      ? (file.name === 'Dockerfile' ? 'bash' : 'makefile')
      : EXTENSIONS[file.extension]
    if (language && hljs.getLanguage(language)) {
      try {
        code.innerHTML = hljs.highlight(source, { language, ignoreIllegals: true }).value
      } catch (error) {
        console.warn('高亮失败，回退纯文本', error)
      }
    }
  }
  return undefined
}
