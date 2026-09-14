# 第三方组件与分发

项目自身和自行编写的 Windows 辅助程序采用根目录 MIT 许可证。

| 组件 | 许可 | 使用方式 |
| --- | --- | --- |
| Electron | MIT，另含 Chromium/Node 等各自许可 | 随发行包分发；保留包内 LICENSE.electron.txt 与 LICENSES.chromium.html |
| Vue | MIT | 编译进入两端页面 |
| ws | MIT | Electron 主进程 WebSocket |
| Zod | MIT | 主进程协议校验 |
| qrcode | MIT | 本地生成二维码 |
| Vite / esbuild | MIT | 开发和构建工具 |
| TypeScript | Apache-2.0 | 开发工具 |
| electron-builder | MIT | 开发打包工具，NSIS 由构建工具下载 |
| Microsoft .NET Framework / Windows API | Windows 系统组件许可 | 使用系统安装的运行时和 API，不重新分发 Windows 系统 DLL |

具体完整许可证以 lockfile 对应软件包的 LICENSE 为准。构建脚本会汇总运行期 JS 软件包（包括被打包进页面的 Vue、qrcode 等）的原始许可证到 `dist/THIRD_PARTY_LICENSES.txt`，并随发行包提供。发行者应保留 Electron 自带的许可证文件。默认不收集遥测，不使用外部字体、CDN 或第三方脚本。
