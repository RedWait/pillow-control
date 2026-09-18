<p align="center">
  <img src="docs/assets/logo.png" width="80" alt="枕控 Logo">
</p>
<h1 align="center">枕控 PillowControl</h1>
<p align="center"><strong>把手机变成电脑的局域网触控板与遥控器。</strong></p>
<p align="center">中文 · <a href="README.en.md">English</a></p>
<p align="center">
  <a href="https://github.com/RedWait/pillow-control/releases/latest">下载</a> ·
  <a href="#quick-start">快速开始</a> ·
  <a href="#preview">功能预览</a>
</p>
<p align="center">
  <a href="https://github.com/RedWait/pillow-control/releases/latest"><img src="https://img.shields.io/github/v/release/RedWait/pillow-control?color=435e53" alt="最新稳定版"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555" alt="MIT 许可证"></a>
  <img src="https://img.shields.io/badge/platform-Windows_x64-555555" alt="Windows x64">
</p>

躺着看剧时，用手机操作电脑鼠标、音量和键盘，不必起身。手机用浏览器打开即可，无需安装 App；电脑画面仍在电脑屏幕上，不传输屏幕。

<a id="preview"></a>
## 看看枕控

<p align="center">
  <img src="docs/assets/mobile-remote.png" width="260" alt="手机已连接的完整遥控主界面：触控板、音量、播放快捷键和工具入口">
</p>
<p align="center"><em>常用操作同屏，文字输入和低频操作按需展开。</em></p>
<p align="center">
  <img src="docs/assets/desktop-pairing.png" width="680" alt="电脑等待配对界面，显示二维码、演示配对码和折叠连接设置">
</p>

> 截图展示 v0.3.0 界面。图片由实际页面渲染，连接状态使用预览数据；地址 `192.0.2.10`、配对码 `123456` 仅用于展示，不能用于连接。手机截图为浏览器视口，不代表手机真机验收。

<details>
<summary>查看配对与更多操作面板</summary>
<p>
  <img src="docs/assets/mobile-pairing.png" width="260" alt="手机配对面板，单一六位数字输入框">
  <img src="docs/assets/mobile-more.png" width="260" alt="更多面板：Esc、显示桌面、Backspace、上下滚动及回车">
</p>
</details>

## 为什么使用枕控

- **手机浏览器直接用**：同一局域网内扫码连接，不需要手机 App 或云账号。
- **把手机当触控板**：相对移动、点按、双击、左右键和双指滚动，灵敏度可调。
- **随手调音量与播放**：系统音量加减、静音，以及空格和左右方向键快捷操作。
- **输入中文和英文**：发送到电脑当前光标位置，不读取或修改剪贴板；关闭面板保留未发送草稿。
- **连续切换窗口**：保持 Alt 逐个选择，确认后释放，也可一键显示桌面。
- **配对一次，之后重连**：保留同一浏览器和网址，电脑程序重启后也能自动连接；支持登录后静默启动。

### v0.3.0 新增

- **远处也能找到鼠标**：默认开启定位光环，跟随系统光标，停止遥控移动约一秒后淡出；电脑端可调整大小，手机设置可开启局部放大镜。
- **更完整的低频操作**：更多面板提供 Esc、显示桌面、删除（Backspace）、上下滚动和回车；修复双指滚动，保留单手备用滚动按钮。
- **按需更新与关机**：电脑端可检查新版本；手机设置中可确认正常关机，不强制结束未保存的应用。

<a id="download"></a>
## 下载

**[前往 GitHub Releases 下载](https://github.com/RedWait/pillow-control/releases/latest)** · [v0.3.0 发布说明](https://github.com/RedWait/pillow-control/releases/tag/v0.3.0)

| 选择 | 适合谁 | WebView2 |
| --- | --- | --- |
| **[安装版 EXE（推荐）](https://github.com/RedWait/pillow-control/releases/download/v0.3.0/pillow-control-0.3.0-setup-x64.exe)** | 日常使用，按当前 Windows 用户安装 | 已包含离线安装程序，体积较大 |
| [便携版 ZIP](https://github.com/RedWait/pillow-control/releases/download/v0.3.0/pillow-control-0.3.0-portable-x64.zip) | 解压即用，愿意自行管理程序目录 | 需要系统已有 WebView2 Runtime |

可用 [SHA-256 校验文件](https://github.com/RedWait/pillow-control/releases/download/v0.3.0/pillow-control-0.3.0-SHA256SUMS.txt)核对下载。没有单独的“离线版”：安装版已内置 WebView2 离线安装程序。便携版的偏好仍保存于当前用户的应用数据目录；开启自启后请保持程序路径不变。

面向 **Windows 10/11 x64**，目前实测 Windows 11；Windows 10、全新系统和缺失 WebView2 的安装分支仍待验收。更新包已使用更新签名校验，但未做 Windows 代码签名，Windows 仍可能显示未知发布者或 SmartScreen 提示。普通用户不需要 Node.js、Python、Rust 或编译工具。

下载软件需要互联网；安装版无需在线下载 WebView2。便携版缺少该运行时时需另行安装，可能需要联网。日常遥控只需局域网；检查和下载更新需要连接 GitHub，网络不可用不影响遥控。

### 从旧版本升级

**v0.2.1 及更早版本需要手动下载安装 v0.3.0**，无需先删除配对数据。v0.3.0 起，电脑端「软件更新」支持手动检查及默认开启、可关闭的启动检查；后续有稳定版时，安装版可下载签名更新包，由你确认后安装，期间会暂时中断遥控。便携版通过发布页面手动下载。

正式版本之间的实际升级安装与升级后设置保留仍待验收，详见[更新说明与发布流程](docs/UPDATES.md)。

<a id="quick-start"></a>
## 快速开始

1. **电脑启动枕控**：安装或解压后运行，查看二维码与 6 位配对码。
2. **手机连到同一网络**：手机连接家庭 Wi-Fi，电脑可用 Wi-Fi 或网线；扫码并在浏览器打开。
3. **首次输入配对码**：输入电脑当前显示的数字，连接后即可操作。
4. **躺下开始遥控**：滑动触控板、调整音量，或打开键盘输入。关闭电脑端窗口后，程序留在托盘运行。

首次配对默认开启登录 Windows 后静默自启，可在电脑端关闭；明确关闭后，再次配对不会重新开启。停止服务、退出或重启电脑会保留配对；主动撤销或重新配对才取消旧凭证。详见[自动连接与自启](docs/AUTOCONNECT.md)。

## 常见问题与边界

**电脑插网线可以吗？** 可以。手机和电脑应连接同一路由器，且能相互访问；访客 Wi-Fi、AP 隔离或不同 VLAN 可能阻断连接。

**页面打不开？** 确认电脑服务已启动、地址选对；防火墙仅允许专用网络。多网卡需先停止遥控再切换。[完整排查步骤](docs/TROUBLESHOOTING.md)包含端口占用、地址变化和防火墙说明。

**播放按钮为什么没反应？** 播放/暂停发送空格，后退/前进发送左右方向键，依赖电脑当前焦点窗口与播放器支持。没有播放状态回传，也没有通用的“下一集”操作；可用鼠标点击播放器。

**手机切后台后怎么办？** 返回页面会自动重连，旧点击、按键和文字不会重放。同一时间只有一个活动控制页面，新页面可接管旧页面。清理浏览器数据、换浏览器、地址变化或主动撤销后，可能需要重新配对。

**能控制所有窗口吗？** 不支持 UAC 安全桌面、锁屏和管理员权限窗口，也不默认以管理员运行。文字输入取决于目标应用对 Unicode 输入的支持。

**局域网连接是否加密？** **没有。** HTTP/WS 会明文传输配对信息和操作内容，仅适合可信家庭局域网。不要配置公网映射或穿透；配对不能代替传输加密。见[安全设计](docs/SECURITY.md)。

## 面向开发者

电脑端采用 **Tauri 2 + Rust**，两端页面使用 **Vue 3 + TypeScript**。手机页面通过 HTTP 配对、通过 WebSocket 发送白名单指令，由 Rust 局域网服务校验并交给 Windows API。页面资源嵌入程序，手机不调用 Tauri API；桌面页面通过受限 commands 管理同一服务。

开发环境：Windows x64、Node.js 22.12+、Rust MSVC（已验证 1.98.1）、Microsoft C++ Build Tools（MSVC 与 Windows SDK）和 WebView2。

```powershell
git clone https://github.com/RedWait/pillow-control.git
cd pillow-control
npm ci
npm run dev
```

```powershell
npm run typecheck
npm test
npm run build   # 构建本地 EXE
npm run pack    # 生成安装版、便携 ZIP 和校验文件
```

首次获取依赖和打包工具需要联网。页面采用构建后运行方式，修改 Vue 后重新运行 `npm run dev`。

- [开发、架构、完整测试与打包命令](docs/DEVELOPMENT.md)
- [Windows 验证记录](docs/VALIDATION.md) · [真机验收清单](docs/ACCEPTANCE.md)
- [当前 UI 精修与验证范围](docs/UI_POLISH.md) · [手机界面验证](docs/MOBILE_UI.md)
- [鼠标定位光环：使用与验证](docs/POINTER_HALO.md)
- [Backspace、滚动修复、鼠标放大镜与关机](docs/REMOTE_ENHANCEMENTS.md)
- [迁移与可恢复基线](docs/MIGRATION.md)

上述功能记录保留开发阶段的验证过程；发布状态以 [v0.3.0 发布说明](docs/RELEASE-0.3.0.md)为准。浏览器模拟、自动化测试和构建成功都不等于实体手机、真实 Wi-Fi 或全新 Windows 的验收通过；实际关机、不同屏幕缩放及播放器覆盖效果仍需真机核对。

## 参与与许可证

欢迎通过 [Issues](https://github.com/RedWait/pillow-control/issues)反馈 Bug 或提出建议。请附版本、Windows/手机浏览器信息、复现步骤和预期结果；截图与日志请移除配对码、令牌和私人内容。

贡献代码前建议先讨论较大改动；提交 PR 时说明变化及验证范围。请保留白名单控制、配对鉴权、断线释放和不重放旧操作的行为。见[贡献指南](CONTRIBUTING.md)。

项目采用 [MIT 许可证](LICENSE)。依赖和分发素材的许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

如果枕控帮你少下了一次床，欢迎点个 ⭐，也欢迎分享给同样懒得起身的朋友。

## 友情链接

[LINUX DO](https://linux.do/) · 真诚、友善、团结、专业的技术社区。
