# 开发与验证

[返回 README](../README.md) · [English README](../README.en.md)

## 开发、检查和打包

需要 Windows x64、Node.js 22.12+、Rust MSVC 工具链 1.98+、Microsoft C++ Build Tools 的「使用 C++ 的桌面开发」（含 MSVC 和 Windows SDK）以及 WebView2 Runtime。本次验证版本：Node 22.22.1、Rust 1.98.1、VS 2022 Build Tools、WebView2 152。

[Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/) · [Windows 安装包文档](https://v2.tauri.app/distribute/windows-installer/)

```powershell
npm ci
npm run dev             # 构建两端 Vue 页面，运行 Tauri 开发版
npm run typecheck
npm test                # 前端连接、手势和共享协议测试
npm run verify:mobile   # 生产页面的手机布局/面板回归，模拟传输，不执行系统输入
npm run check:rust
npm run test:rust       # Rust 鉴权、HTTP/WS、队列、协议契约测试
npm run build           # release exe，不生成安装包
npm start               # 运行已有 release exe
npm run pack            # NSIS 离线安装包、便携 ZIP、SHA-256
```

npm 脚本会识别用户目录下的 `.cargo/bin`，无须为了本项目修改系统 PATH。提交的 npm/Cargo lockfile 固定依赖；首次拉取依赖与下载 NSIS、WebView2 离线包需要互联网，应用运行不依赖外部服务。

当前前端采用构建后运行方式；修改 Vue 后重新运行 `npm run dev`，没有依赖常驻 Vite 服务。Rust 开发构建由 Tauri 监视。单独运行 Cargo 前先 `npm run build:frontend`（手机资源必须存在才能编译嵌入）。覆盖 exe 前从托盘退出该版本。

`npm run build` 输出 `src-tauri/target/release/pillow-control.exe`。Tauri 原始安装包在 `src-tauri/target/release/bundle/nsis/`，`npm run pack` 将便于分发的文件复制到 `release/`。保留许可证文本与便携 ZIP 一起分发。

## 架构

```text
apps/desktop-ui/           原有 Vue 桌面面板、二维码；受限 Tauri bridge
apps/mobile/               原有 Vue 手机界面、连接和纯手势状态机
shared/                    TypeScript 协议、Zod 校验、跨语言契约样例
src-tauri/src/main.rs       Tauri commands、单实例、窗口和托盘
src-tauri/src/service.rs    桌面命令和托盘共享的生命周期
src-tauri/src/server.rs     axum HTTP/WS、嵌入手机页面、鉴权
src-tauri/src/security.rs   随机凭证、撤销、限速
src-tauri/src/protocol.rs   Rust 白名单及严格运行时校验
src-tauri/src/control.rs    有界串行队列、合并移动、优先释放、看门狗
src-tauri/src/windows_control.rs  SendInput / Core Audio Windows 适配
src-tauri/src/network.rs    实体/虚拟网卡和 IPv4 地址
src-tauri/src/transport.rs  TCP 连接数量和空闲超时限制
src-tauri/tests/            Rust 测试（使用替身，不冒充系统控制实测）
native/VerificationHost.cs  仅开发验证用的按钮/记事本测试靶标，不随包分发
scripts/                   构建、许可汇总、打包、Windows 实测脚本
```

手机 → HTTP 配对 → 认证 WebSocket → Rust 校验和队列 → Rust Windows API。桌面通过两个受限 commands 管理同一个核心服务，不重复网络控制逻辑。手机页面不调用 Tauri API，发行程序不捆绑 Node 服务或 C# 控制辅助程序。两端生产资源均编译进 exe，运行目录不必包含源码或前端构建目录。

桌面 capabilities 仅授权本地 `main` 窗口读取状态与管理服务，没有通用 shell、文件权限或远程窗口授权。状态按秒轮询，避免暴露不必要的 IPC 能力。详情见 [安全设计](SECURITY.md)。

## 实测与验收

以下测试会实际移动鼠标、点击专用测试窗口、改变并恢复系统音量、打开记事本输入测试文本、切换窗口。请保持桌面解锁，运行期间不要使用键鼠。

```powershell
npm run build
npm run verify:windows   # 需要本机 Chrome；使用已有 .NET Framework 编译测试靶标
npm run verify:desktop   # Tauri 窗口、二维码、commands、停止/启动/退出测试
# 验证最终便携文件（测试工具仍在开发机运行，目标程序的 PATH 只有 Windows 系统目录）：
$env:PILLOW_EXECUTABLE = "$PWD\release\pillow-control-0.2.1-portable-x64\pillow-control.exe"
npm run verify:windows
npm run verify:desktop
Remove-Item Env:\PILLOW_EXECUTABLE
```

`--verify-server` 是仅本地 stdin/stdout 可用的测试模式，不增加网络或桌面 API。浏览器从真实嵌入手机页配对；结果读取系统坐标、靶标 Click、记事本 UIA 文本、Core Audio、前台窗口及 Alt 状态。桌面测试临时启用本测试进程的 WebView2 本地调试端口，普通启动不启用。测试会留下专用记事本测试标签，请自行关闭，不处理个人文档。

本版的已测结果与准确待测项见 [验证记录](VALIDATION.md)，实体 Android/iPhone、真实路由器组合、全新 Windows 安装和人工托盘菜单按 [真机验收清单](ACCEPTANCE.md) 检查。构建通过不等于这些实测通过。

## 迁移前基线与恢复

基线 `c32406496b3d795e411b0aab4a0b31cf33f2ec7b`（Electron 0.1.0）；迁移分支 `codex/tauri2-migration`。源码和文档在写迁移代码前已提交，另有本地 `artifacts/pillow-control-electron-baseline.bundle`。原发行产物保留。

```powershell
git worktree add ../pillow-control-electron c324064
# 在新目录 npm ci，再 npm run dev；无需 reset 当前迁移分支。
```

复用/替换对照及技术资料见 [迁移记录](MIGRATION.md)。
手机界面改版、浏览器验证范围与真机补验步骤见 [手机界面验证](MOBILE_UI.md)。更新后请完全退出旧电脑程序，再运行新版并刷新手机网页。

## Signed updates

See [软件更新与签名发布](UPDATES.md) for key setup, `npm run pack:release -- docs/RELEASE-x.y.z.md`, explicit draft-first publishing, and update acceptance. Regular `npm run pack` remains a local unsigned-updater build.
