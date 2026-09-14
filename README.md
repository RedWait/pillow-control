# 枕控 PillowControl

躺在床上，用手机浏览器遥控同一局域网里的 Windows 电脑。调音量、移动鼠标、输入中文、切换窗口，无需安装手机 App。

**PillowControl is a local-network remote for Windows, built with Electron, Vue 3 and TypeScript. Use your phone browser as a touchpad, volume controller and Unicode keyboard. No cloud, accounts, database or screen streaming.**

当前版本：`0.1.0`，仓库和 package 名统一为 `pillow-control`。项目代码采用 MIT 许可证。

## 直接运行

支持 Windows 11 x64，以及自带 .NET Framework 4.8 的 Windows 10 1903+ x64。第一版本机验证环境是 Windows 11 26200 x64；Windows 10、ARM64 仿真和不同手机尚需实机验证。

- 便携版：双击 `release/pillow-control-0.1.0-portable-x64.exe`。
- 安装版：双击 `release/pillow-control-0.1.0-setup-x64.exe`，按当前用户安装，无需管理员权限。
- 解包版：运行 `release/win-unpacked/枕控 PillowControl.exe`。分发此版本时必须保留整个目录。

普通用户无需安装 Node、Python、.NET SDK 或编译工具。辅助程序使用 Windows 自带的 .NET Framework；发行包自带 Electron 与所有网页资源。此首版未做代码签名，Windows 可能显示未知发布者；发布到公众前应配置可信代码签名。

## 扫码、配对与使用

1. 电脑连接路由器（网线或 Wi-Fi 都可以）；手机连接同一路由器的家庭 Wi-Fi。
2. 启动枕控。默认选择 Windows 确认的实体网卡，并显示地址、二维码和 6 位配对码。
3. 手机相机扫码，用浏览器打开地址；也可以直接输入 `http://电脑地址:19827`。
4. 在手机输入电脑显示的配对码。二维码仅包含地址，不包含配对码或令牌。
5. 单指相对滑动移动鼠标；点按单击，连续点两次双击；双指上下滑动滚动。下方也有左右键和备用滚动按钮。
6. 音量加减与静音直接控制 Windows 默认多媒体输出设备。空格、方向键、回车、Esc 是发给当前窗口的快捷键，具体效果取决于窗口和播放器。
7. 「切换窗口」首次按下保持 Alt，继续按「下一个 / 上一个」，最后按「确认」释放；「取消」退出选择。3 秒没有新系统指令会自动释放，防止卡键。可连续浏览多个窗口。
8. 「输入文字」中输入中文或英文，先确保电脑目标输入框已获得焦点，再点击发送。每次最多 1000 个 UTF-16 代码单元。输入法组词期间禁用发送，发送等待系统确认期间防止重复点击。

中文使用 `SendInput + KEYEVENTF_UNICODE`，**完全不读取、不写入剪贴板**，原剪贴板内容保持不变。Windows 接受指令不等于目标应用已处理文字；若超时或断线，先检查电脑，避免手动重发重复内容。

电脑端支持停止遥控、断开并撤销手机、重新配对。停止 / 重新配对 / 退出会撤销凭证；重启服务后需重新配对。每次成功配对也会替换旧凭证。一次仅允许一台手机控制；同一令牌的新页面接管连接。令牌保存在手机浏览器本地存储中，服务端只在内存保存其 SHA-256 摘要。

关闭电脑窗口后程序留在系统托盘。托盘可以恢复窗口、停止遥控、明确退出。手机页面隐藏或关闭会释放按键并断开，切回后自动重连，不重放旧点击、按键和文字。

## 开发与构建

需要 Windows x64、Node.js 22.12+（建议使用本项目验证的 22.22.1）及 npm。使用 Windows 内置 .NET Framework C# 编译器，不需要安装 Visual Studio / .NET SDK。

```powershell
npm ci
npm run dev             # 编译辅助程序、两端页面与 Electron，然后启动
npm start               # 启动已有构建
npm run typecheck
npm test
npm run build
npm run pack:dir        # 生成 release/win-unpacked
npm run pack            # 生成 x64 便携 exe 和 NSIS 安装包
```

修改代码后重新运行 `npm run dev`。当前是可复现的构建后运行工作流，没有接入热更新。重新编译辅助程序或覆盖打包目录前，先从托盘退出正在运行的对应版本，否则 Windows 会锁定 exe。

`.npmrc` 固定 `legacy-peer-deps=true`，配合已提交的 lockfile，绕过 npm 10 对工具链可选 peer 的解析问题。`npm ci --ignore-scripts --dry-run` 已验证 lockfile 一致性。不要省略安装脚本做正式安装，因为 Electron 需要下载其运行时。初次安装依赖、下载 Electron/NSIS 时需要网络；程序运行不依赖网络外部服务。默认 npm 镜像若无审计接口，可运行：

```powershell
npm audit --registry=https://registry.npmjs.org
```

## 架构

```text
apps/desktop/      Electron 生命周期、托盘、IPC、HTTP/WS、凭证、指令队列
apps/desktop-ui/   Vue 桌面连接面板；只有受限 preload 接口
apps/mobile/       Vite + Vue 手机页面、连接管理、纯手势状态机
shared/            TypeScript 协议与 Zod 运行时严格校验
native/Helper.cs   Windows SendInput / Core Audio 适配层
native/VerificationHost.cs  仅开发验收使用的真实 Windows 测试窗口
scripts/           编译、打包和真实链路验收入口
tests/             安全边界、HTTP/WS 集成、队列与手势测试
docs/              真机验收清单、验证记录、安全说明
```

数据流：手机 → 配对 HTTP 接口 → 带令牌认证的 WebSocket → Electron 主进程运行时校验 → 有界串行调度 → 私有 stdin/stdout → Windows 辅助程序 → 系统 API。

主进程和 preload 分开构建。桌面渲染器启用 `sandbox`、`contextIsolation`，关闭 `nodeIntegration`，禁止打开新窗口和导航；手机没有 Node 权限。辅助程序不监听任何端口，也不接受网络输入。仅显式允许的协议指令能抵达 Windows 层。

## 安全边界

**配对不等于传输加密。** 当前使用 LAN HTTP/WS，配对码、令牌和文字会经过未加密传输。仅在可信家庭网络使用，勿在酒店、公共、访客或不可信办公网络启动服务；不要配置公网端口映射、穿透或代理。项目不自动开放防火墙、不配置 UPnP、不连接云服务、不记录输入文字。安全细节见 [安全说明](docs/SECURITY.md)。

服务只绑定所选网卡的一个 IPv4 地址，不绑定 `0.0.0.0`。实体网卡优先，虚拟 / VPN / 类型不明网卡明确标记并允许手动选择；找不到实体网卡时等待选择。新地址必须停止后再切换。网络断开、电脑休眠或 DHCP 地址变化后可能需要重新扫码。

保护包括：密码学随机配对码与 256 位令牌、配对限速与 10 分钟有效期、凭证撤销、精确 Host/Origin 校验、防跨站来源、消息严格校验、8 KiB 上限、每连接 100 条/秒、文字每 10 秒 4 次、单活动连接、连接握手超时、心跳与辅助程序 3 秒按键看门狗。没有任意 shell、脚本、上传下载、文件访问或通用 HTTP 控制接口。CSP 禁止第三方脚本与框架嵌入。

## 局域网故障排查

| 现象 | 检查方式 |
| --- | --- |
| 手机上页面打不开 | 确认两端在同一路由器；电脑网线连接是支持的。访客 Wi-Fi、AP 隔离、企业 VLAN 会阻止互访。 |
| 防火墙弹窗 | 只允许专用网络；需要时在 Windows 防火墙中为当前枕控 exe 添加专用网络入站许可，TCP 19827。不要关闭整个防火墙。 |
| 端口被占用 | 退出其他枕控实例；用 `Get-NetTCPConnection -LocalPort 19827` 查占用，再处理对应程序。首版固定端口 19827。 |
| 多网卡地址不对 | 停止遥控，选择真实 WLAN / 以太网。虚拟网卡可有正常-looking IPv4 地址，因此必须结合网卡类型判断。 |
| 原地址失效 | Wi-Fi、VPN 或 DHCP 改变后重新选择地址、启动、扫码。当前网页中的 token 按地址独立保存。 |
| 配对码失效 / 429 | 电脑点重新配对；多次输错后等待一分钟。重新配对撤销此前手机凭证。 |
| 已连接但不能输入 | 先点选电脑目标输入框。程序不支持 UAC 安全桌面、锁屏或高权限窗口；不应为此默认管理员运行。 |
| 音量无法改变 | 确认 Windows 存在默认输出设备。RDP、虚拟声卡、独占播放器需实机验证。 |
| 暂停 / 快进无效 | 空格、方向键只是快捷键，取决于焦点和播放器支持；可使用鼠标操作实际按钮。 |
| 手机后台断线 | 属于预期；返回页面后自动重连。服务停止或凭证撤销时需重新配对。 |

## 真实 Windows 验证

先退出其他枕控实例，保持桌面解锁，测试期间不要操作鼠标键盘。以下命令**会实际移动鼠标、点击专用窗口、调整并恢复音量、启动记事本输入测试中文、切换窗口**：

```powershell
npm run build
npm run verify:windows
```

验收采用 Electron 内真实浏览器页面完成配对及 WebSocket 发送，读取系统鼠标坐标、Core Audio 音量、Windows 窗口句柄、测试按钮 Click 事件和记事本 UI Automation 文本；不是用日志模拟成功。报告写到 `artifacts/windows-verification.json`。测试生成 `%TEMP%/pillow-control-chinese-*.txt`，记事本可能保留测试标签；请自行关闭，无需清理任何个人文档。

打包版本也可使用同一套验收：

```powershell
$env:PILLOW_EXECUTABLE = (Resolve-Path 'release/win-unpacked/枕控 PillowControl.exe').Path
$env:PILLOW_VERIFY_FIXTURE = (Resolve-Path 'artifacts/VerificationHost.exe').Path
$env:PILLOW_VERIFY_OUTPUT = Join-Path $PWD 'artifacts/packaged-verification.json'
npm run verify:windows
Remove-Item Env:PILLOW_EXECUTABLE
Remove-Item Env:PILLOW_VERIFY_FIXTURE
Remove-Item Env:PILLOW_VERIFY_OUTPUT
```

浏览器自动化与桌面 Windows 验证不等于实体手机验收。完整状态见 [验证记录](docs/VALIDATION.md)，逐项操作见 [真机验收清单](docs/ACCEPTANCE.md)。

## 第一版限制

- 无屏幕传输、远程唤醒、广域网控制、账号、数据库、播放器专属适配。
- 无鼠标按住拖拽或多手机同时控制；点击会成对发送按下/松开。
- 不保证所有软件支持 Unicode 注入；游戏、密码管理器、高权限应用需单独评估。
- 断线或超时后不重放操作。已经送入 Windows 的事件无法撤回，系统确认也不保证目标应用响应。
- 代码尚未经过独立安全审计。无自动更新；开源发行维护者应定期更新 Electron 安全版本。

## 依赖选择依据

2026-09-14 核对 npm 版本与官方文档，使用 Electron 44.3.0、Vue 3.5.42、Vite 8.3.0、TypeScript 5.9.3、ws 8.21.3、Zod 4.6.5、electron-builder 26.15.3。准确版本由 `package-lock.json` 锁定。

- [Vite Node 版本要求](https://vite.dev/guide/)：Node 20.19+ / 22.12+。
- [Electron 上下文隔离](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[进程沙箱](https://www.electronjs.org/docs/latest/tutorial/sandbox)。
- [Windows SendInput 与 UIPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。
- [Core Audio 音量接口](https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nf-endpointvolume-iaudioendpointvolume-volumestepup)。
- [.NET Framework Windows 系统要求](https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements)。
- [electron-builder Windows 分发](https://www.electron.build/docs/win/)、[NSIS / portable](https://www.electron.build/v26/docs/nsis/)。
- [CSP 与 WebSocket 浏览器差异](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)：显式允许当前地址的 WS 来源，避免只写 `self` 的兼容性问题。

Windows 辅助程序由项目自己编译，调用微软系统接口；不依赖 Electron ABI 或第三方输入驱动。`extraResources` 将其放在 ASAR 外随包分发。开源依赖许可与分发注意事项见 [第三方说明](THIRD_PARTY_NOTICES.md)。
