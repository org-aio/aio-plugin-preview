# 文件工作区浏览器回归

`workbench.cjs` 使用 Playwright 在桌面和手机尺寸验证 Markdown 编辑、实时预览清理、切换草稿、取消清空、下载字节一致性、下载后自动打开、当前文件下载、STEP/STP、IGES、BREP 和 CAD 搜索/图层/全图。

由测试环境提供 Playwright 和 Chromium，插件本身不依赖 Playwright。配置 `AIO_URL`、`AIO_TEST_DATA`、`AIO_TEST_OUTPUT`；验收已安装插件时额外提供 `AIO_SESSION`，会话仅通过环境变量传入，不写到报告。

数据目录需要 `fixtures/sample.md`、`fixtures/cube.stp`、`fixtures/cube.igs`、`fixtures/sample.brep`、`dwg/example_2004.dxf`。工程模型样例来自 [occt-import-js 官方测试文件](https://github.com/kovacsv/occt-import-js/tree/main/test/testfiles)，分别为 `simple-basic-cube/cube.stp`、`cube-10x10mm/Cube 10x10.igs`、`cax-if-brep/as1_pe_203.brep`；DXF 来自 LibreDWG 官方测试样例。测试报告和截图保存在配置的输出目录。

`history.cjs` 在真实宿主验证桌面和手机的历史保存、去重、清空保留、刷新重开、取消删除和删除后刷新。使用 `AIO_URL`、`AIO_SESSION`、`AIO_TEST_OUTPUT`，只创建和删除测试自己的记录。
