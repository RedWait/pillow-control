# Tauri 2 迁移对照

基线：`c32406496b3d795e411b0aab4a0b31cf33f2ec7b`（Electron v0.1.0，首次本地提交）。
迁移分支：`codex/tauri2-migration`。额外 Git 备份：`artifacts/pillow-control-electron-baseline.bundle`。
原始 release/、artifacts/、output/ 保留；基线已包含迁移前全部项目源码与文档。

恢复建议：在另一目录执行 `git worktree add ../pillow-control-electron c324064`，再 `npm ci` / `npm run dev`。不需要重置或清理当前迁移工作。也可以从 bundle 克隆。

| 产品行为 / 边界 | 原实现 | 迁移方式 |
| --- | --- | --- |
| 手机深色 Vue UI、横竖屏、触控板布局 | apps/mobile | 原样复用 |
| 相对移动、点按/双击、双指滚动、灵敏度、取消 | gestures.ts / App.vue | 复用并保留原测试 |
| 中文 composition、发送确认、防重复、不重放 | connection.ts / App.vue | 复用 |
| 连接/重连/单页面接管 | WebSocket 协议 | 保持 JSON 消息和关闭码兼容 |
| 桌面 Vue 连接面板与二维码 | apps/desktop-ui | 保留设计，仅替换受限桥接实现 |
| 网卡枚举和选择、端口占用提示 | Node os / PowerShell | Rust Windows IP Helper API |
| HTTP 静态页面与 WS | Node http / ws | Rust axum / tokio；编译嵌入手机资源 |
| 6 位随机码、10 分钟有效、令牌摘要、撤销 | Node crypto | Rust OS RNG、SHA-256、常量时间比较 |
| Host/Origin、白名单、消息大小、限速 | TS/Zod 服务端 | Rust serde 严格反序列化及显式范围校验；共享协议契约测试 |
| 有界移动队列、断线释放、按键看门狗 | Node 调度 + C# | Rust 单控制线程、有界合并队列、优先释放 |
| 鼠标/按键/Unicode 文本/Alt 连续切换/显示桌面 | C# SendInput | Rust windows crate 直接调用 Windows API |
| 音量/静音 | C# Core Audio COM | Rust Core Audio；COM 仅在控制线程初始化 |
| 剪贴板 | 完全不访问 | 保持不访问 |
| 关闭/最小化到托盘、停止、退出 | Electron | Tauri 2 窗口与托盘；统一核心服务生命周期 |
| 本地渲染器权限隔离 | preload / sandbox | 本地 main 窗口专属 capabilities + 限定 commands；手机无 Tauri API |
| 无 Node / 无 C# 辅助程序的发行包 | Electron resources | Rust exe 内嵌资源；Tauri NSIS |

验收原则：先通过实际 Windows 控制与独立打包资源测试，再移除旧实现。旧文件删除遵守一次一个明确文件路径，不批量删除目录。


## 具体版本和兼容性证据

Tauri Rust 2.11.5 / CLI 2.11.4 / JS API 2.11.1，axum 0.8.9，tokio 1.53.1，windows 0.62.2；Rust 1.98.1 MSVC。版本以两份 lockfile 固定，不要求各个独立发布包的补丁版本相同。Vue 3.5.42 / Vite 8.3.0 / TypeScript 5.9.3 继续沿用。C++ Build Tools 安装经用户明确授权，本机已确认 MSVC 和 Windows SDK 可用，release 链接成功。

- Tauri Windows 前置条件：https://v2.tauri.app/start/prerequisites/
- NSIS 和离线 WebView2：https://v2.tauri.app/distribute/windows-installer/
- 命令能力隔离：https://v2.tauri.app/security/capabilities/
- 托盘 API：https://v2.tauri.app/learn/system-tray/
- Windows Rust API：https://microsoft.github.io/windows-docs-rs/

## 完成情况及风险

上表全部产品功能均有对应实现；apps/mobile 和桌面 CSS 相对基线无改动。真实 Windows 关键链路通过后，已逐文件移除 Electron 入口、Node 服务、C# 控制层及原打包脚本，凭证/调度/服务测试迁移到 Rust。共享样例由 Rust 和 TypeScript 同时运行，防止两个协议实现漂移。原 Electron 发行文件、未跟踪构建目录和 baseline bundle 保留，不批量清理。

迁移带来的主要边界：桌面依赖系统 WebView2，安装包为此捆绑离线安装程序；不再使用 Electron ABI 或 Node 原生模块；3 秒释放看门狗在 Rust 进程内运行，不保证整个进程被强杀后的释放。实际手机及新系统兼容性仍按 ACCEPTANCE.md 人工确认，详见 VALIDATION.md。
