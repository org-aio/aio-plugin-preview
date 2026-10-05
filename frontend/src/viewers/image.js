// 图片：直接交给浏览器解码，SVG/位图统一处理。
export default function image(container, file, helpers) {
  const url = helpers.objectUrl()
  const element = document.createElement('img')
  element.src = url
  element.alt = file.name
  element.style.maxWidth = '100%'
  element.style.margin = '0 auto'
  element.addEventListener('error', () => {
    helpers.fail(`无法解码图片「${file.name}」，可能是浏览器不支持的格式（如 HEIC/TIFF）`)
  })
  container.replaceChildren(element)
  return () => helpers.revoke(url)
}
