#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

# 前端：安装依赖并构建静态资产到 dist/frontend。
cd frontend
npm ci --ignore-scripts
npm run build
cd ..

# 后端：构建 Linux x86_64、glibc 2.17 兼容的 process 可执行文件。
cargo test --locked
cargo zigbuild --locked --release \
  --target x86_64-unknown-linux-gnu.2.17

cp target/x86_64-unknown-linux-gnu/release/aio-plugin-preview dist/server
chmod 0755 dist/server
