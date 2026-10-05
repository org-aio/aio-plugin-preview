# AIO 文件预览插件

在 AIO 工作空间内直接预览常见工程文件，**全部解析都在浏览器里完成**，不上传内容到第三方服务，也不需要部署额外的转换服务。

## 支持的格式

| 渲染器 | 格式 |
| --- | --- |
| CAD | `dwg` `dxf`（libredwg WebAssembly，浏览器内解析） |
| 3D 模型 | `glb` `gltf` `obj` `stl` `ply` `fbx` `dae` `3mf` `vtk` `pcd` `xyz`（Three.js） |
| 文档 | `pdf`（PDF.js）、`docx`（docx-preview）、`xlsx` `xls` `ods`（SheetJS）、`md` |
| 图片 | `png` `jpg` `gif` `webp` `bmp` `svg` `avif` `ico` `tif` 等 |
| 音视频 | `mp4` `webm` `mov` `mp3` `wav` `flac` 等（浏览器原生解码） |
| 代码文本 | 80+ 扩展名，Highlight.js 按需高亮 |
| 压缩包 | `zip` 目录浏览（JSZip） |

未识别的扩展名给出下载入口，不会静默失败。

## 结构与边界

- `src/main.rs`：Topcoat process 后端，只提供运行时契约（`/health`、`/aio/describe`）与格式能力表。
- `src/formats.rs`：**前后端唯一的格式事实来源**，经 `/api/formats` 暴露。
- `frontend/`：静态前端。壳与格式表很小，各渲染器按扩展名懒加载。

后端不接触文件内容：渲染发生在前端沙箱 iframe 内，通过宿主通信桥调用插件 API。

### DWG / DXF 的解析路径与边界

- **DWG**：libredwg 的 WebAssembly 构建，浏览器内解析私有二进制格式，无云端转换。
- **DXF**：用 `dxf-parser` 解析（DXF 是公开文本格式）。随包的 libredwg 构建**只编译了 DWG 读取**——`dwg_read_data` 对任何 DXF 都返回空指针，最小合法文件也一样，因此 DXF 走独立适配器，再归一成同一套渲染结构。
- 渲染统一由 `dwg-render.js` 完成：逐实体转换、逐条兜底，单个坏实体不会让整张图空白，跳过项会在界面提示。

角度约定：两条路径的弧角度都是**弧度**（DXF 的 50/51 组码由 dxf-parser 换算），且从 start 逆时针扫到 end。

覆盖与限制：

| 项 | DWG | DXF |
| --- | --- | --- |
| 覆盖范围 | 常规 2D 图纸 | dxf-parser 支持的实体类型 |
| 暂不渲染 | `3DSOLID`、`ACAD_TABLE`、`MULTILEADER`、`TOLERANCE`、`VIEWPORT`、OLE | `HATCH`、`WIPEOUT`、`XLINE`、`RAY`、`MLINE` 等解析器未实现的类型 |

- 遇到损坏文件或超出支持范围的图纸，libredwg 会让 WASM 实例进入不可用状态；插件会立即重建实例（约 50ms），保证不影响后续文件。

## 构建

```bash
sh scripts/build.sh
```

脚本依次执行：前端 `npm ci && npm run build`、后端 `cargo test && cargo zigbuild --release --target x86_64-unknown-linux-gnu.2.17`，最后把产物组装到 `dist/`（`dist/server` 与 `dist/frontend/`）。

本地开发（需要 AIO 宿主）：

```bash
cargo run            # 或 aio plugin dev .
```

前端可独立开发：`cd frontend && npm run dev`（此时通过同源接口读取格式表）。

## 验证

```bash
cargo test --locked              # 后端契约与格式表
cd frontend && npm test          # 渲染器与注册表单测
aio plugin validate .
```

## 发布

推送到默认分支后由 AIO 构建服务自动构建上架；也可本地打包直发：

```bash
aio plugin validate .
aio plugin package . --version <SemVer> -o dist/plugin.aio-plugin
AIO_PLUGIN_PUBLISH_TOKEN=<来源绑定凭证> aio plugin publish dist/plugin.aio-plugin
```

## 许可

MIT

第三方：libredwg 为 GPL-3.0（以 WebAssembly 形式随包分发），Three.js、PDF.js、SheetJS、docx-preview、JSZip、marked、Highlight.js 均为各自开源许可。
