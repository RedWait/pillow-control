# 第三方组件与分发

枕控 PillowControl 自有代码采用 MIT 许可证。

| 组件 | 许可 | 用途 |
| --- | --- | --- |
| Tauri 2 / tauri-plugin-single-instance | MIT 或 Apache-2.0 | 桌面窗口、托盘、受限 IPC、单实例 |
| windows / windows-core | MIT 或 Apache-2.0 | 微软维护的 Rust Windows API 绑定 |
| axum / tokio | MIT | Rust HTTP/WebSocket 和异步运行时 |
| serde / serde_json / getrandom / sha2 / include_dir | MIT 或 Apache-2.0（具体以原许可为准） | 协议、随机数、摘要和编译嵌入资源 |
| Vue / qrcode / @tauri-apps/api | MIT | 两端页面、二维码、桌面桥接 |
| Zod | MIT | 共享 TypeScript 协议与契约验证 |
| Vite / Playwright / TypeScript | 各自 MIT 或 Apache-2.0 | 仅开发构建和验证工具 |
| Microsoft Edge WebView2 Runtime | Microsoft WebView2 分发条款 | 系统 WebView；NSIS 包含微软离线安装程序 |

`scripts/licenses.mjs` 按锁定 npm 依赖和 Cargo metadata 汇总第三方原始许可到 `tauri-dist/THIRD_PARTY_LICENSES.txt`。为避免漏列，Rust 汇总也包含 Windows 目标的构建/测试依赖，JS 汇总包含页面依赖的传递依赖。NSIS 和便携 ZIP 均附带此文件与项目 LICENSE。依赖版本以 package-lock.json / src-tauri/Cargo.lock 为准。

不分发 Windows 系统 DLL、Rust 编译器、Node、Electron 或 C# 控制辅助程序。开发验收靶标使用系统 .NET Framework，不包含在发行包内。离线安装程序按 [Microsoft WebView2 分发文档](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) 获取并安装 WebView2。