import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// 3D 模型：Three.js 渲染，按扩展名选择对应加载器。
// GLTF/GLB 是 Web 标准格式，其余格式由各自加载器在浏览器内解析。

const LOADERS = {
  glb: () => import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => ({ kind: 'gltf', Loader: m.GLTFLoader })),
  gltf: () => import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => ({ kind: 'gltf', Loader: m.GLTFLoader })),
  obj: () => import('three/examples/jsm/loaders/OBJLoader.js').then((m) => ({ kind: 'object', Loader: m.OBJLoader })),
  stl: () => import('three/examples/jsm/loaders/STLLoader.js').then((m) => ({ kind: 'geometry', Loader: m.STLLoader })),
  ply: () => import('three/examples/jsm/loaders/PLYLoader.js').then((m) => ({ kind: 'geometry', Loader: m.PLYLoader })),
  fbx: () => import('three/examples/jsm/loaders/FBXLoader.js').then((m) => ({ kind: 'object', Loader: m.FBXLoader })),
  dae: () => import('three/examples/jsm/loaders/ColladaLoader.js').then((m) => ({ kind: 'collada', Loader: m.ColladaLoader })),
  '3mf': () => import('three/examples/jsm/loaders/3MFLoader.js').then((m) => ({ kind: 'object', Loader: m['ThreeMFLoader'] ?? m.Loader })),
  vtk: () => import('three/examples/jsm/loaders/VTKLoader.js').then((m) => ({ kind: 'geometry', Loader: m.VTKLoader })),
  pcd: () => import('three/examples/jsm/loaders/PCDLoader.js').then((m) => ({ kind: 'points', Loader: m.PCDLoader })),
  xyz: () => import('three/examples/jsm/loaders/XYZLoader.js').then((m) => ({ kind: 'points', Loader: m.XYZLoader }))
}

// 解析成统一的 Object3D。不同加载器的返回类型差异较大（Object3D / BufferGeometry /
// { scene } / { data }），这里逐类归一，避免把非 Object3D 直接塞进场景。
async function parse(extension, bytes) {
  if (['step', 'stp', 'iges', 'igs', 'brep'].includes(extension)) {
    const { parseCadModel } = await import('./step.js')
    return parseCadModel(extension, bytes)
  }
  if (!LOADERS[extension]) { throw new Error(`不支持的模型格式：${extension}`) }
  const entry = await LOADERS[extension]()
  const loader = new entry.Loader()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

  switch (entry.kind) {
    case 'gltf': {
      // GLTFLoader.parseAsync 返回整个 gltf 对象，要取其中的 scene。
      const gltf = await loader.parseAsync(buffer, '')
      return gltf?.scene ?? null
    }
    case 'collada': {
      // ColladaLoader.parse 返回 { scene }。
      return loader.parse(new TextDecoder().decode(bytes), '')?.scene ?? null
    }
    case 'object': {
      // OBJ/FBX/3MF 直接返回 Object3D。
      const text = extension === 'obj' || extension === 'fbx' ? new TextDecoder().decode(bytes) : null
      const result = text === null ? loader.parse(buffer) : loader.parse(text, '')
      return result ?? null
    }
    case 'points': {
      // PCDLoader 返回 Points；XYZLoader 返回 BufferGeometry。
      const result = loader.parse(buffer)
      if (result?.isObject3D) return result
      return toMesh(result, true)
    }
    default: {
      // STL/PLY/VTK 返回 BufferGeometry。
      return toMesh(loader.parse(buffer), false)
    }
  }
}

function toMesh(geometry, points) {
  if (!geometry?.attributes?.position) return null
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  if (points) {
    return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1, color: 0x93b4c8 }))
  }
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x93b4c8, metalness: 0.1, roughness: 0.75 })
  )
}

export default async function model(container, file, helpers) {
  const object = await parse(file.extension, file.bytes)
  if (!object) throw new Error(`无法解析 ${file.extension.toUpperCase()} 模型`)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x11161c)
  scene.add(object)

  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z) || 1

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(radius, radius, radius)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.5)
  fill.position.set(-radius, -radius, -radius)
  scene.add(fill)

  const camera = new THREE.PerspectiveCamera(45, 1, radius / 1000, radius * 1000)
  if (['step', 'stp', 'iges', 'igs', 'brep'].includes(file.extension)) { camera.up.set(0, 0, 1) }
  camera.position.set(center.x + radius * 1.4, center.y + radius * 1.1, center.z + radius * 1.6)
  camera.lookAt(center)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // WebGLRenderer 只暴露 domElement，没有 style 属性。
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
  container.replaceChildren(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.update()

  const resize = () => {
    const width = container.clientWidth || 800
    const height = container.clientHeight || 520
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  let running = true
  const frame = () => {
    if (!running) return
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  frame()

  let triangles = 0
  let vertices = 0
  object.traverse((node) => {
    const geometry = node.geometry
    if (!geometry?.attributes?.position) return
    vertices += geometry.attributes.position.count
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
  })
  helpers.report(
    `已解析 ${file.extension.toUpperCase()} 模型 · 三角面 ${Math.round(triangles)} 个 · 顶点 ${vertices} 个 · 尺寸 ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`
  )

  return () => {
    running = false
    observer.disconnect()
    controls.dispose()
    renderer.dispose()
    object.traverse((node) => {
      node.geometry?.dispose?.()
      const material = node.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose?.())
      else material?.dispose?.()
    })
  }
}
