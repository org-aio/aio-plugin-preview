// 3D 模型：Three.js 渲染，按扩展名选择对应加载器。
// GLTF/GLB 是 Web 标准格式，其余格式由各自加载器在浏览器内解析。

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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

// 解析为统一的 Object3D，便于统一加灯光、取包围盒。
async function parse(extension, bytes) {
  const entry = await (LOADERS[extension] ?? LOADERS.glb)()
  const loader = new entry.Loader()

  // 多数加载器接受 ArrayBuffer 或文本；GLTF 需要按扩展名指定路径以解析外部引用。
  if (entry.kind === 'gltf') {
    return loader.parseAsync(bytes.buffer, '')
  }
  if (entry.kind === 'collada') {
    const result = loader.parse(new TextDecoder().decode(bytes), '')
    return result.scene
  }
  if (extension === 'obj' || extension === 'fbx') {
    const text = new TextDecoder().decode(bytes)
    return loader.parse(text, '')
  }
  const geometry = loader.parse(bytes.buffer)
  if (entry.kind === 'points' && geometry.isPoints) return geometry
  const material = new THREE.MeshStandardMaterial({
    color: 0x93b4c8,
    metalness: 0.1,
    roughness: 0.75,
    flatShading: false
  })
  const mesh = new THREE.Mesh(geometry, material)
  // 点云类几何没有法线，补一份以保证被光照正常着色。
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  return mesh
}

export default async function model(container, file, helpers) {
  const extension = file.extension
  const object = await parse(extension, file.bytes)
  if (!object) throw new Error(`无法解析 ${extension.toUpperCase()} 模型`)

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
  camera.position.set(center.x + radius * 1.4, center.y + radius * 1.1, center.z + radius * 1.6)
  camera.lookAt(center)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.style.cssText = 'display:block;width:100%;height:100%'
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

  const triangles = (() => {
    let total = 0
    object.traverse?.((node) => {
      const geometry = node.geometry
      const index = geometry?.index
      if (index) total += index.count / 3
      else if (geometry?.attributes?.position) total += geometry.attributes.position.count / 3
    })
    return Math.round(total)
  })()
  helpers.report(
    `已解析 ${extension.toUpperCase()} 模型 · 三角面 ${triangles} 个 · 尺寸 ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}`
  )

  return () => {
    running = false
    observer.disconnect()
    controls.dispose()
    renderer.dispose()
    object.traverse?.((node) => {
      node.geometry?.dispose?.()
      const material = node.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose?.())
      else material?.dispose?.()
    })
  }
}
