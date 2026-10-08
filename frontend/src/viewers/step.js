import occtimportjs from 'occt-import-js'
import * as THREE from 'three'

let enginePromise

// OpenCascade 在浏览器内把工程曲面离散为网格，WASM 跟随插件资产发布。
export async function parseCadModel(extension, bytes) {
  if (!enginePromise) {
    enginePromise = occtimportjs({
      locateFile: () => new URL('occt-import-js.wasm', document.baseURI).href
    }).catch((error) => {
      enginePromise = null
      throw error
    })
  }
  const engine = await enginePromise
  const reader = { step: 'ReadStepFile', stp: 'ReadStepFile', iges: 'ReadIgesFile', igs: 'ReadIgesFile', brep: 'ReadBrepFile' }[extension]
  const result = engine[reader](bytes, { linearUnit: 'millimeter', linearDeflection: 0.001 })
  if (!result.success || !result.meshes?.length) {
    throw new Error('工程模型解析失败：文件损坏或不含可显示的曲面')
  }
  const group = new THREE.Group()
  for (const mesh of result.meshes) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3))
    geometry.setIndex(mesh.index.array)
    if (mesh.attributes.normal) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3))
    } else {
      geometry.computeVertexNormals()
    }
    const color = mesh.color ? new THREE.Color(...mesh.color) : new THREE.Color(0x93b4c8)
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.65, side: THREE.DoubleSide })
    const object = new THREE.Mesh(geometry, material)
    object.name = mesh.name || ''
    group.add(object)
  }
  return group
}
