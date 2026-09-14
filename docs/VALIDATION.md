# 第一版验证记录

验证日期：2026-09-14，Windows 11 专业版 10.0.26200 x64，Node 22.22.1，Electron 44.3.0。

## 已实现

桌面连接面板、实体/虚拟网卡识别及选择、二维码和配对码、启动/停止、撤销手机、托盘和退出；手机相对触控板、左右键、双击、双指及备用滚动、灵敏度、Core Audio 音量/静音、快捷键、连续窗口选择与确认、显示桌面、Unicode 文字输入；配对、来源校验、限速、有界队列、心跳、释放和重连。

## 已完成验证

| 层次 | 结果与证据 |
| --- | --- |
| 类型检查 | `npm run typecheck` 通过 |
| 自动化测试 | `npm test`，5 个文件、27 项通过；覆盖鉴权、来源、撤销、限速、消息大小/结构、重复序号、断线释放/清队列、双指/取消、重连不重放、多页面接管不争抢 |
| 构建 | Windows 辅助程序、Electron 主进程/preload、两端 Vue 页面均构建通过 |
| 依赖审计 | 使用官方 npm registry 审计，0 项；修复构建工具 esbuild 的低危公告后使用 0.28.1 |
| Windows 开发版真实链路 | Electron 内真实浏览器 → HTTP 配对 → WS → Helper → 系统 API；真实鼠标移动、专用按钮单击、记事本中文 UIA 读回、系统音量变化、Alt 保持与连续切换确认、断线释放通过 |
| Windows 打包目录真实链路 | `app.isPackaged=true`，从 `resources/native/PillowControl.Helper.exe` 加载；相同真实系统操作通过，见 `artifacts/packaged-verification.json` |
| 最终便携 exe | 最终发行 exe 解压启动、包内 Helper 加载及 8 项真实系统检查通过；另在子进程 PATH 仅保留 Windows 系统目录、无 Node/Python 路径时重复通过，退出码 0。见 `artifacts/portable-verification.json` 和 `artifacts/portable-no-node-verification.json`；不等于全新系统测试 |
| 产品信息 | Windows exe ProductName 和 FileDescription 均为「枕控 PillowControl」，版本 0.1.0.0 |
| 桌面 UI | 窗口截图检查；本机 WLAN 识别为实体网卡，另一个隧道网卡标为虚拟；二维码由本地生成 |
| 手机网页 | Chromium 使用真实局域网地址访问；正确配对、刷新重连通过；390×844 / 844×390 布局截图检查；compositionstart 期间发送禁用，结束后恢复 |
| 分发 | 已生成 NSIS 安装 exe、便携 exe 和 win-unpacked 目录；全部资源本地随包分发 |

Windows 数据来自实际系统状态：测试靶标 Click 计数为 1，记事本读回「枕控中文输入验证 PillowControl 123」，Core Audio 音量由 0.16 变为 0.18 后恢复，窗口句柄发生变化，断线后 `altHeld=false`。测试采用辅助窗口，不在个人文件上执行点击。

原始 JSON 保存在 `artifacts/`，含系统窗口标题与本机路径，仅供本地审查，不提交到公开仓库。浏览器截图位于 `output/playwright/`，桌面截图位于 `artifacts/desktop.png`。

最终两个发行 exe 的 SHA-256 见 `release/SHA256SUMS.txt`。正式手机 Vue 页面的音量按钮也经过真实验证（16% → 18% → 16%），控制台 0 错误；详见 `artifacts/browser-verification.json`。发行目录附带本记录的最终副本。

## 待实体设备 / 人工验收

- Android Chrome 与 iPhone Safari 的真实触摸、双指滚动、系统中文输入法、软键盘和安全区。
- 手机 Wi-Fi 与有线电脑的实际路由器组合、防火墙许可、访客网络隔离及真实断网重连。
- NSIS 安装向导完整操作、卸载流程、全新无开发环境 Windows 电脑。
- 多显示器、不同缩放/鼠标加速、不同音频设备、Windows 10，以及各播放器的实际焦点和快捷键行为。
- UIA 文本读回验证不是所有软件的兼容性保证；UAC、安全桌面和管理员窗口不在首版范围内。

按 [真机清单](ACCEPTANCE.md) 操作。构建和自动化通过不等同于这些待测项已通过。
