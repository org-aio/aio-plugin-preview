// 音视频：使用浏览器原生解码，不做转码。
function build(container, file, helpers, tag) {
  const url = helpers.objectUrl()
  const element = document.createElement(tag)
  element.src = url
  element.controls = true
  element.preload = 'metadata'
  element.style.maxWidth = '100%'
  element.style.margin = '0 auto'
  if (tag === 'video') element.style.maxHeight = 'calc(100vh - 220px)'
  element.addEventListener('error', () => {
    helpers.fail(`浏览器无法解码「${file.name}」；如需通用播放请转码为 MP4(H.264)/WebM`)
  })
  container.replaceChildren(element)
  return () => helpers.revoke(url)
}

export const video = (container, file, helpers) => build(container, file, helpers, 'video')
export const audio = (container, file, helpers) => build(container, file, helpers, 'audio')
