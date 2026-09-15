# 枕控 PillowControl

躺在床上，用手机浏览器遥控同一局域网里的 Windows 电脑。调音量、移动鼠标、输入中文、切换窗口，无需手机 App。

**PillowControl is a local-network Windows remote built with Tauri 2, Rust, Vue 3 and TypeScript. Your phone browser becomes a touchpad, volume controller and Unicode keyboard. No cloud, accounts, Node.js runtime or screen streaming.**

当前版本 `0.2.0`，仓库与 package 名称统一为 `pillow-control`，项目采用 MIT 许可证。本版由既有 Electron 版本迁移；手机端采用单屏遥控主界面与按需展开的底部面板，保留原有控制能力。

## 运行与连接

面向 Windows 10/11 x64；已实测 Windows 11 26200。Windows 10 与全新系统仍需验收。

- 安装版：`release/pillow-control-0.2.0-setup-x64.exe`。按当前用户安装，安装包含 WebView2 离线安装程序，普通用户无需 Node、Python、Rust 或编译工具。
- 便携版：解压 `release/pillow-control-0.2.0-portable-x64.zip`，运行其中 `pillow-control.exe`。便携版需要系统已有 Microsoft Edge WebView2 Runtime；Windows 11 通常已具备。缺少时使用安装版。
- 产品名称及两端标题均为「枕控 PillowControl」。发行包暂未代码签名，Windows 可能提示未知发布者。

1. 电脑通过网线或 Wi-Fi 连接路由器，手机连接同一路由器的家庭 Wi-Fi。
2. 打开枕控，默认选择实体网卡，显示局域网地址、二维码和 6 位配对码。多网卡时可停止遥控后选择正确地址，再启动。
3. 手机扫码用浏览器打开，或输入 `http://电脑地址:19827`。二维码只含地址，不含凭证。
4. 输入电脑上的配对码即可遥控。单指相对移动；点按单击，连续两次点按双击；双指上下滚动。触控板底部提供左右键；备用滚动位于「更多」。
5. 音量加减、静音控制 Windows 默认多媒体输出。空格、方向键、回车、Esc 是发给当前焦点窗口的快捷键，实际效果取决于播放器；没有假定统一的全屏或下一集快捷键。
6. 「切换窗口」保持 Alt，连续点「下一个 / 上一个」选择多个窗口，点「确认窗口」释放，或「取消选择」退出。3 秒无新控制操作会自动释放。
7. 输入文字前先让电脑目标输入框获得焦点。点击底部「键盘」，在面板内输入并完成选字后点击发送，最多 1000 个 UTF-16 单元。组词和等待发送确认期间不能重复提交。关闭面板保留草稿，成功确认后清空；失败保留文字。显示桌面、Esc、回车与备用滚动在「更多」；连接管理、灵敏度及帮助在右上角设置。

文字通过 Windows `SendInput + KEYEVENTF_UNICODE` 输入，**不读取、不修改剪贴板**。Windows 接收事件不代表任意目标应用都支持该输入方式。断线或超时后不会重发，请先检查电脑再手动重试。

电脑端可停止遥控、断开并撤销手机、重新配对。停止、退出和重启服务会保留配对；主动撤销手机或重新配对才会撤销旧凭证；一次只允许一个活动控制页面，同一令牌的新页面接管旧页面。关闭或最小化桌面窗口会隐藏到托盘，托盘支持恢复、停止和明确退出。

手机页面隐藏、关闭或手势取消会清理待发送操作并释放按键；返回页面自动重连。旧点击、按键和文字不会在重连后重放。

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

桌面 capabilities 仅授权本地 `main` 窗口读取状态与管理服务，没有通用 shell、文件权限或远程窗口授权。状态按秒轮询，避免暴露不必要的 IPC 能力。详情见 [安全设计](docs/SECURITY.md)。

## 局域网安全与故障排查

**配对不等于传输加密。** HTTP/WS 明文传输配对码、令牌和输入内容，只适合可信家庭 LAN。不要用于公共、访客、不可信办公网络，不要配置公网映射、穿透或代理。程序不自动修改防火墙、UPnP 或路由器，不依赖 CDN，不记录输入文本。

服务仅监听选定的一个 IPv4 地址，不绑定所有网卡。精确检查 Host/Origin；首次配对需随机码，后续用 256 位随机令牌；服务端仅保存摘要。配对限速、有效期、消息大小、消息/文字频率、有界队列、单活动连接和按键看门狗均在 Rust 端执行。

| 现象 | 检查方式 |
| --- | --- |
| 页面打不开 | 检查同一路由器；网线电脑受支持。访客 Wi-Fi、AP 隔离、企业 VLAN 会阻断互访。 |
| 防火墙弹窗 | 只允许专用网络；必要时为当前枕控 exe 添加 TCP 19827 专用网络入站许可，不关闭整个防火墙。 |
| 端口占用 | 从托盘退出旧版枕控；用 `Get-NetTCPConnection -LocalPort 19827` 查看占用程序。 |
| 多网卡选错 | 停止服务，选择实际 WLAN/以太网。VPN/虚拟/类型未知网卡明确标记；无实体网卡时手动选择。 |
| DHCP 或 Wi-Fi 变化 | 重新选择地址并扫码；地址变化会停止失效的监听。 |
| 配对失效或 429 | 电脑重新配对；频繁尝试后等待一分钟。凭证重置后必须输入新码。 |
| 已连接但不能输入 | 点选目标输入框。UAC、锁屏和管理员权限窗口不在首版范围，不要因此默认管理员运行。 |
| 音量控制失败 | 检查 Windows 默认音频输出设备；独占模式、RDP 和特殊虚拟声卡需另测。 |
| 播放快捷键无效 | 依赖焦点及播放器支持，可用鼠标点真实播放按钮。 |
| 手机切后台断线 | 属于预期，返回自动重连；服务停止或凭证撤销后重新配对。 |

## 实测与验收

以下测试会实际移动鼠标、点击专用测试窗口、改变并恢复系统音量、打开记事本输入测试文本、切换窗口。请保持桌面解锁，运行期间不要使用键鼠。

```powershell
npm run build
npm run verify:windows   # 需要本机 Chrome；使用已有 .NET Framework 编译测试靶标
npm run verify:desktop   # Tauri 窗口、二维码、commands、停止/启动/退出测试
# 验证最终便携文件（测试工具仍在开发机运行，目标程序的 PATH 只有 Windows 系统目录）：
$env:PILLOW_EXECUTABLE = "$PWD\release\pillow-control-0.2.0-portable-x64\pillow-control.exe"
npm run verify:windows
npm run verify:desktop
Remove-Item Env:\PILLOW_EXECUTABLE
```

`--verify-server` 是仅本地 stdin/stdout 可用的测试模式，不增加网络或桌面 API。浏览器从真实嵌入手机页配对；结果读取系统坐标、靶标 Click、记事本 UIA 文本、Core Audio、前台窗口及 Alt 状态。桌面测试临时启用本测试进程的 WebView2 本地调试端口，普通启动不启用。测试会留下专用记事本测试标签，请自行关闭，不处理个人文档。

本版的已测结果与准确待测项见 [验证记录](docs/VALIDATION.md)，实体 Android/iPhone、真实路由器组合、全新 Windows 安装和人工托盘菜单按 [真机验收清单](docs/ACCEPTANCE.md) 检查。构建通过不等于这些实测通过。

## 迁移前基线与恢复

基线 `c32406496b3d795e411b0aab4a0b31cf33f2ec7b`（Electron 0.1.0）；迁移分支 `codex/tauri2-migration`。源码和文档在写迁移代码前已提交，另有本地 `artifacts/pillow-control-electron-baseline.bundle`。原发行产物保留。

```powershell
git worktree add ../pillow-control-electron c324064
# 在新目录 npm ci，再 npm run dev；无需 reset 当前迁移分支。
```

复用/替换对照及技术资料见 [迁移记录](docs/MIGRATION.md)。
手机界面改版、浏览器验证范围与真机补验步骤见 [手机界面验证](docs/MOBILE_UI.md)。更新后请完全退出旧电脑程序，再运行新版并刷新手机网页。

## 首次配对后自动连接与静默自启

首次配对后，在当前 Windows 用户的应用数据目录保存令牌摘要；手机仍用浏览器本地凭证认证。停止/退出/电脑重启后，使用同一浏览器访问同一网址即可自动连接。新配对仍替换旧手机凭证，主动「断开并撤销手机」或「重新配对」永久取消旧凭证。

首次配对默认开启「开机自动启动（静默到托盘）」，可在电脑端取消；明确取消后，再配对不会擅自开启。实际是在 Windows 用户登录后启动，不控制登录界面。启动项使用当前用户权限，不需要管理员；手动打开程序仍显示窗口。开机网络未就绪会每 5 秒重试，主动停止遥控后不会自动恢复。

建议在路由器为电脑保留固定 DHCP 地址：网址/IP 或端口变化、换浏览器、隐私模式或清理网站数据后，可能需要重新配对。便携版开启自启后请保留原目录；移动目录后手动打开并重新设置。局域网 HTTP 仍未加密。验证及限制见 [自动连接验收](docs/AUTOCONNECT.md)。
