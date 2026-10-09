# AIO 文件预览插件

在 AIO 工作空间内直接预览常见工程文件，**全部解析都在浏览器里完成**，不上传内容到第三方服务，也不需要部署额外的转换服务。

## 支持的格式

| 渲染器 | 格式 |
| --- | --- |
| CAD | `dwg` `dxf`（libredwg WebAssembly，浏览器内解析） |
| 3D 模型 | `step` `stp` `iges` `igs` `brep`（OpenCascade WASM）、`glb` `gltf` `obj` `stl` `ply` `fbx` `dae` `3mf` `vtk` `pcd` `xyz`（Three.js） |
| 文档 | `pdf`（PDF.js）、`docx`（docx-preview）、`xlsx` `xls` `ods`（SheetJS）、`md`（编辑、实时预览、下载修改版） |
| 图片 | `png` `jpg` `gif` `webp` `bmp` `svg` `avif` `ico` `tif` 等 |
| 音视频 | `mp4` `webm` `mov` `mp3` `wav` `flac` 等（浏览器原生解码） |
| 代码文本 | 80+ 扩展名，Highlight.js 按需高亮 |
| 压缩包 | `zip` 目录浏览（JSZip） |

未识别的扩展名给出下载入口，不会静默失败。

## 结构与边界

- `src/main.rs`：Topcoat process 后端，提供运行时契约、格式能力表与用户浏览历史。
- `src/formats.rs`：**前后端唯一的格式事实来源**，经 `/api/formats` 暴露。
- `frontend/`：静态前端。壳与格式表很小，各渲染器按扩展名懒加载。

渲染发生在前端沙箱 iframe 内；浏览历史通过宿主通信桥把文件副本保存到插件数据库，供用户再次打开。

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

## 0.1.8 新增能力

- 多文件列表、文件名筛选、切换；清空同步移除全部文件及草稿。
- Markdown 编辑和实时预览；切换文件保留内存草稿，下载修改版后自动打开新文件。下载不会覆盖原文件，刷新页面会丢失未下载的草稿。
- STEP/STP、IGES/IGS、BREP 由 occt-import-js 在浏览器内转为网格，工程模型使用 Z 轴向上，输出单位为毫米。新增依赖是因为 Three.js 没有 STEP 读取器，完整 opencascade.js 体积更大。DOMPurify 清理 Markdown 原始 HTML。
- CAD 图层开关、文字搜索、回车/按钮逐个定位、显示全图。尚不支持 CAD 改字、DWG 写回、PDF 导出与图框分页。
- 移除没有加载器的 3DS 声明。压缩包在线目录浏览目前仅 ZIP，其余格式明确提示下载。

真实浏览器回归脚本：`frontend/e2e/workbench.cjs`。运行时通过环境变量提供 `AIO_URL`、`AIO_TEST_DATA`、`AIO_TEST_OUTPUT`；测试安装后的宿主插件时额外提供 `AIO_SESSION`。Playwright 由测试环境提供，不加入插件运行依赖。

OpenCascade / occt-import-js 遵循 LGPL-2.1 及 OpenCascade exception，DOMPurify 为 Apache-2.0 或 MPL-2.0，随依赖保留其许可。

AIO 沙箱禁止 iframe 直接下载，正式使用 `aioPlugin.download` 宿主桥；下载上限 16 MiB，旧宿主会给出明确错误并保留草稿。

## 0.1.9 浏览历史

浏览成功后保存文件副本和最后打开时间，按宿主注入的租户、用户隔离，刷新或换浏览器登录后可以重新打开。原始文件内容会存储在 AIO 插件专用 PostgreSQL 数据库；未下载的编辑草稿仍只在内存中，下载修改版后新文件进入历史。

保存期限为最后打开起 30 天，读取列表时清理，进程每小时额外清理过期正文。相同名称和内容去重；每人最多 100 条 / 256 MiB，单文件上限 4 MiB，超过上限显示未保存提示。删除历史会删除副本，工作区“清空”只清理当前文件和草稿。

数据库迁移在 `migrations/001_preview_history.sql`，进程从 AIO 授权配置读取数据库连接，本地测试通过 `AIO_PREVIEW_DATABASE_URL` 指定独立数据库。运行 `cargo test --locked history_retention -- --ignored` 验证过期边界和隔离。

### 0.1.10 左侧统一文件栏

已打开文件和 30 天浏览历史合并在左侧，共用筛选框；已打开的历史副本不重复列出。条目旁可删除历史，清空预览后左侧历史仍可重新打开；保存说明收起在文件栏底部。手机尺寸采用顶部紧凑文件栏。
