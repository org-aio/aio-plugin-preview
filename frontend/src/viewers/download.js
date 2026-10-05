// 兜底：不能内嵌预览的格式给出明确的下载入口。
export default function download(container, file, helpers) {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'display:grid;place-items:center;gap:14px;padding:56px 24px;text-align:center'
  const title = document.createElement('p')
  title.textContent = `「${file.name}」暂不支持内嵌预览`
  title.style.cssText = 'margin:0;font-weight:650'
  const hint = document.createElement('p')
  hint.textContent = '可下载后使用本机应用打开。'
  hint.style.cssText = 'margin:0;opacity:.7;font-size:13px'
  const link = document.createElement('a')
  link.href = helpers.objectUrl()
  link.download = file.name
  link.textContent = '下载文件'
  link.className = 'download'
  link.addEventListener('click', () => setTimeout(() => helpers.revoke(link.href), 10000))
  wrapper.append(title, hint, link)
  container.replaceChildren(wrapper)
  return () => helpers.revoke(link.href)
}
