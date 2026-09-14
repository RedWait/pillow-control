# Tauri 2 迁移验证记录

日期：2026-09-14。环境：Windows 11 专业版 10.0.26200 x64，Node 22.22.1，Rust 1.98.1 MSVC，Visual Studio 2022 C++ Build Tools，WebView2 152.0.4191.66。

## 已实现与保留

手机 Vue 页面、CSS、手势和连接管理原样复用；桌面面板设计保持，仅替换桥接。Rust 实现嵌入静态页、HTTP/WS、配对和撤销、严格协议、限速、队列、网卡识别、Windows SendInput/Core Audio。Tauri 负责 commands、单实例、托盘和窗口；不分发 Electron、Node 服务或 C# 控制辅助程序。详细逐项对照见 MIGRATION.md。

## 已通过的验证

| 层次 | 证据及边界 |
| --- | --- |
| 前端 | vue-tsc 通过；Vitest 4 个文件 40 项通过，含保留的手势/连接测试及 23 个共享协议样例。 |
| Rust | cargo check、clippy 全目标零警告，11 个 Rust 测试通过；凭证有效期/撤销/限速、非法字段、严格协议、队列合并/溢出/断线取消、HTTP/WS 来源/鉴权/重放/停止/心跳等测试。测试替身不代表实际 Windows 操作。 |
| 生产构建 | Tauri release exe 与 NSIS（包含 WebView2 离线安装程序）生成；便携 ZIP 附带原始第三方许可。产品属性为枕控 PillowControl / 0.2.0。 |
| 真实浏览器到系统 | Chromium 加载 release exe 内嵌手机页，UI 配对并建立 WS；真实光标坐标变化、专用按钮 Click 计数、记事本 UIA 中文与 emoji 读回、Core Audio 音量与静音变化、Alt 连续选择及三个不同前台窗口通过。 |
| 输入与连接 | 真实手机页面模拟 composition 时禁发，完成后发送一次并从记事本读回；剪贴板序列号未变化；断线释放 Alt、自动重连、刷新复用令牌、撤销退回配对通过。模拟事件不替代实体手机输入法。 |
| 独立资源 | 被测 release 程序在 TEMP 工作目录启动，PATH 仅有 Windows 系统目录；没有 Vite 开发服务器，HTTP 页和控制均正常。测试驱动本身仍在开发机使用 Node/Chrome，不等于全新电脑测试。 |
| 桌面 | WebView2 实际窗口和截图：中文标题、网卡列表、二维码；仅允许的 commands 可用，未知命令被拒绝；停止释放端口、再次启动、退出码 0 且端口关闭。 |
| 窗口生命周期 | 向本次启动的窗口发送原生关闭/最小化事件后窗口隐藏、服务继续；再次启动的第二实例退出并恢复原窗口；退出后无对应后台服务。托盘菜单鼠标操作仍需人工验收。 |
| 依赖 | 官方 npm registry 审计 0 项；运行依赖兼容性按官方 Tauri 文档、Rust windows crate 源码及本机 MSVC 构建确认。不是完整安全审计。 |

本地证据：`artifacts/tauri-windows-verification.json`（20 项真实/集成检查）、`artifacts/tauri-desktop-verification.json`（13 项桌面检查），截图在 `output/playwright/tauri-mobile.png` 和 `tauri-desktop.png`。这些记录包含本机路径/窗口信息，不提交公开仓库。

最终分发校验在 `release/pillow-control-0.2.0-SHA256SUMS.txt`。发行文件的验证以对应 JSON 中的 exe 路径为准，不沿用 Electron 0.1.0 的验证结论。

## 尚需实体设备或人工确认

- Android Chrome / iPhone Safari 真正触摸、双指、中文输入法选字、软键盘、安全区、横竖屏。
- 手机 Wi-Fi + 有线电脑的路由器组合、防火墙授权、AP 隔离、实际断网与休眠唤醒。
- 安装向导、卸载、无 WebView2 全新 Windows 的离线运行；Windows 10。
- 托盘菜单的人工点击、多个显示器/缩放/鼠标加速/音频设备和特定播放器兼容性。
- UAC、锁屏、管理员窗口不在本版支持范围。强杀进程后的释放不作保证，详见 SECURITY.md。

按 ACCEPTANCE.md 记录通过/失败/未测，不能用构建成功填写真机结果。

## 安装后验证补充

已将 NSIS 以当前用户静默安装（/S /NS）到独立的 artifacts/installed-tauri-0.2.0，安装退出码 0，不创建快捷方式。安装后程序的 20 项 Windows 控制/连接检查、13 项桌面生命周期检查均通过，退出后 19827 和测试调试端口均无监听。证据分别为 artifacts/tauri-installed-windows.json 与 tauri-installed-desktop.json。当前机器已有 WebView2，因此未触发缺失运行时分支；内置 WebView2 安装程序签名已检查为 Microsoft Corporation / Valid。

测试安装保留在该目录并登记于 Windows 已安装应用，可继续人工验收；未自动执行卸载。安装向导交互、卸载和无 WebView2 的全新机器仍属于待测。

最终便携目录中的 pillow-control.exe 也独立通过 20 项 Windows 检查与 13 项桌面检查，见 artifacts/tauri-portable-windows.json 和 tauri-portable-desktop.json。两种发行形式均从 TEMP 工作目录、仅系统目录 PATH 启动，没有源码或开发服务器依赖。
