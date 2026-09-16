# 软件更新

电脑端展开「软件更新」可查看当前版本、手动检查及设置「启动时检查更新」。默认启动检查开启，选择会保存在原有 preferences.json 中。检查需要访问 GitHub，不影响离线局域网遥控；后台无更新或网络失败不弹窗、不打开托盘中的窗口。

发现稳定版后显示版本、发布日期和原文更新说明。安装版可下载已签名的更新，显示实际下载字节数；签名通过后还需点击「安装更新…」并确认。确认会停止遥控、释放保持中的输入状态、退出枕控并打开有界面的安装器。安装结束后重新打开枕控。关闭窗口、暂时不安装或检查失败不会清除配对。

## 安装版与便携版

- 安装版：当前 EXE 所在目录必须与 HKCU 卸载登记的 InstallLocation 一致，并存在 uninstall.exe。
- 便携包带 pillow-portable.json 标记，优先识别为便携版。它只检查版本并打开发布页面；退出枕控后将新便携包解压到新的目录，再启动。若设置了自启，请在新位置关闭再开启自启以更新路径。
- 未确认来源（例如开发构建、移走的 EXE、旧便携包）：同样只提供手动下载，不猜测可安装。
- 配对和用户选择仍位于原有用户数据目录，不移入安装目录。NSIS 的 /UPDATE 升级卸载保留自启注册项；普通卸载仍清理自启。首次从旧版手动升级后，启动程序会根据保存的自启偏好重新应用路径。

## 当前发布状态与首次接入

本次核实的公开稳定版为 **v0.2.1**，已有安装包、便携 ZIP 和 SHA256SUMS，**没有 updater 签名或 latest.json**。旧版没有内置更新入口，必须手动安装首个带此功能、公钥和签名资产的新版本，后续才能在软件内升级。

v0.3.0 已配置维护者生成的正式更新公钥。私钥和密码仍保存在维护者本机，客户端不包含私钥。只有识别为安装版且目标稳定版提供完整有效签名资产时，才开放内置下载安装。

## 一次性签名配置（维护者）

先安装仓库文档要求的 Node、Rust/MSVC、WebView2，以及 GitHub CLI，并完成 gh auth login。私钥保存在仓库之外、有访问控制且已备份的位置；不要上传到 Issues 或粘贴到聊天。

在 PowerShell 中运行，路径仅为示例：

~~~powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.pillow-control-signing"
npx tauri signer generate -w "$env:USERPROFILE\.pillow-control-signing\updater.key"
npm run updater:key -- "$env:USERPROFILE\.pillow-control-signing\updater.key.pub"
~~~

生成时交互设置密码。只提交 tauri.conf.json 中的**公钥**。妥善备份私钥和密码；丢失私钥后无法为信任旧公钥的客户端签发更新，不能只换公钥便期待旧客户端接受。

在准备发布的当前 PowerShell 会话设置签名环境变量，不写进脚本或 .env，不在命令行直接写密码：

~~~powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.pillow-control-signing\updater.key"
$secret = Read-Host "Updater key password" -AsSecureString
$credential = New-Object System.Net.NetworkCredential("", $secret)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $credential.Password
~~~

发布完清除当前会话变量：

~~~powershell
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Remove-Variable secret, credential
~~~

执行发布前需安装 [GitHub CLI](https://cli.github.com/) 并完成 `gh auth login`。当前流程本地运行，不需要 GitHub Secrets。以后迁入 Actions 时，将同名私钥内容和密码保存为仓库 Secrets，只在受信任的发布 job 注入；公钥仍是普通配置。不要在 fork PR 上注入密钥，不打印签名环境变量。当前仓库没有新增会自动发布的工作流。

**Tauri 更新签名与 Windows 代码签名不同。** 前者验证安装包由持有更新私钥的人签发，不能消除 SmartScreen 或证明 Windows 发布者身份。Windows Authenticode 证书和代码签名是另一项独立配置。

## 每次发布

1. 同步修改 package.json、src-tauri/Cargo.toml 和 src-tauri/tauri.conf.json 的版本（稳定的 x.y.z）；更新锁文件中的本项目版本，写好 docs/RELEASE-x.y.z.md。可先用 `npm version x.y.z --no-git-tag-version` 更新 npm 版本与锁文件，修改另外两份配置后运行 `node scripts/cargo.mjs check` 更新 Cargo.lock。必须高于所有已发布稳定版，不使用预发布或已有标签。
2. 配置上述签名环境变量；运行检查并准备安装包：

~~~powershell
npm run typecheck
npm test
npm run check:rust
npm run test:rust
npm run pack:release -- docs/RELEASE-x.y.z.md
~~~

脚本使用官方 createUpdaterArtifacts=true 构建 Windows x64 NSIS，沿用离线 WebView2 分发，不改变原有普通 npm run pack。正式更新包位于 release/updates/vx.y.z/：

| 文件 | 用途 |
| --- | --- |
| pillow-control-x.y.z-setup-x64.exe | Windows 安装包 |
| pillow-control-x.y.z-setup-x64.exe.sig | 官方 updater 签名 |
| pillow-control-x.y.z-portable-x64.zip | 带便携标记的便携包 |
| latest.json | windows-x86_64 版本、日期、说明、固定下载地址及签名 |
| pillow-control-x.y.z-SHA256SUMS.txt | 发布附件的校验值 |

本地另存公钥供签名复核，不上传私钥。脚本拒绝覆盖已有版本的更新暂存目录。准备失败时保留现场，先检查错误与目录，不盲目发布。普通 npm run pack 不会生成可发布的 updater 元数据。

3. 在隔离 Windows 用户/虚拟机验收安装包和升级，审查源码并手动提交、推送到本仓库。准备和提交应对应同一份源码。发布命令不会替你提交或推送：

~~~powershell
npm run release:publish -- docs/RELEASE-x.y.z.md
~~~

该命令拒绝脏工作区、远端不存在的提交、旧版本以及已有 Release/标签。重新验证签名和清单后，创建草稿、上传所有附件，并重新下载远端草稿附件核对 SHA-256；全部成功才公开并设置 latest。失败时保持草稿，绝不覆盖旧 Release。不要手工提前公开缺少签名或 latest.json 的草稿。

## 实现与权限边界

- 官方 tauri-plugin-updater 2.11.0，Rust 端调用 check / download / install。下载成功必须通过官方签名验证；安装前再次验证内存中的已下载字节。
- GitHub Releases latest API 获取稳定版，显式拒绝 draft / prerelease，按 SemVer 比较，拒绝降级。后续元数据绑定具体版本的 GitHub URL；安装包地址必须匹配同仓库同标签、预期文件名，不能由界面提交任意 URL。
- 检查请求 15 秒超时、整个检查最多 35 秒，安装包下载 10 分钟超时，上限 512 MiB；API 响应上限 1 MiB。操作互斥，重复点击不能启动另一下载或安装。失败可重试，安装器启动失败尝试恢复原先运行中的遥控服务。
- 两个本地 commands 受 main 窗口及本地 URL 双重约束。没有为前端开放 updater 插件的原始安装/下载权限，也没有 LAN 更新接口或通用执行/打开 URL 接口。
- 更新检查是用户可关闭的 GitHub 联网行为；局域网遥控仍不依赖 GitHub。更新使用 HTTPS 和签名；遥控 HTTP/WS 仍未加密。

官方资料：[Tauri updater](https://v2.tauri.app/plugin/updater/)、[Tauri Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)。接口同时以 Cargo.lock 中实际解析的官方插件源码核对。

## 验证范围

自动测试覆盖稳定版比较、拒绝降级/预发布、旧设置默认值与保存、发行类型判断、更新互斥、发布元数据匹配，以及官方插件真实 HTTP 下载下的有效签名、篡改签名、下载 404 和离线失败。测试 HTTP 仅绑定回环地址并使用公开测试向量，无生产私钥；不执行测试载荷。

桌面测试和本轮结果见文末验收记录。以下必须在正式签名配置后验收，不以构建通过替代：

- 从首个已签名安装版升级到更高稳定版，下载进度及签名验证通过；确认前进程不退出，确认后输入释放、服务停止且有界面安装器启动。
- 安装完成后版本正确；手机无需重新配对，原有自启、光环、网卡、启动检查偏好保持。
- 安装器取消、文件被占用/杀毒拦截时用户仍可手动启动旧版；安装入口启动失败可重试。
- 真实安装路径、旧安装版和便携包分别识别正确；便携包没有应用内安装按钮。
- 托盘登录启动期间发现更新/网络失败不弹窗、不抢焦点；再次打开窗口能查看结果。

## 本轮验收记录（2026-09-16）

- 类型检查、57 项前端/发布清单测试、29 项 Rust 测试通过。
- 官方 updater 使用回环 HTTP 服务和公开签名向量实测：无更新、新版本、有效签名、篡改内容、下载 404 和离线失败。
- 本机真实 Tauri/WebView2：GitHub 返回 v0.2.1 已是最新版；并发检查只执行一次；直接调用原始 updater 插件被权限拒绝；启动检查关闭后重启仍关闭；便携标记构建拒绝内置下载。
- 实际以 --autostart 启动，检查前后窗口均保持隐藏。测试结束恢复原偏好与自启登记，没有安装更新。
- 浏览器预览数据：新版本说明、下载状态、独立安装确认、取消、失败重试，以及 760/608/480 px 宽度下可访问。此项不代表安装成功。截图与 JSON 结果在 output/playwright/updates/，重新运行 `npm run verify:updates` 可生成。
- 正式发布前缺少生产公钥时，`pack:release` 已验证会提前拒绝。生产密钥的完整签名打包、GitHub 草稿上传与实际升级/设置保留尚未验收；本轮没有发布或覆盖任何 Release。

- `node scripts/verify-update-signing.mjs` 已用仓库外一次性测试密钥对本次真实 NSIS 安装包生成签名，Rust 校验通过；篡改安装包被拒绝，元数据校验通过。测试私钥已删除，未写入客户端或生产配置。此测试不代表生产签名配置或实际安装已完成。

## 本机交互签名打包

发布准备完成后，在项目 PowerShell 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-release.ps1`。密码通过本机隐藏输入读取，脚本不会记录密码；签名环境变量在结束时恢复或移除。此脚本只生成签名包，不发布。
