# 枕控 PillowControl v0.3.0

本版增加鼠标定位光环和软件内检查更新，并完善手机遥控的低频操作。

## 新增与改进

- 电脑端新增软件更新：手动检查、默认开启且可关闭的启动检查、更新说明、下载进度和独立安装确认。托盘静默启动不因更新检查打开窗口。
- 安装版使用 Tauri 官方 updater 验证签名；确认安装后停止遥控并释放输入。便携版只提供发布页面下载入口。更新检查需要连接 GitHub，离线不影响局域网遥控。
- 远距离鼠标定位光环：默认开启，可在电脑端选择大小；跟随真实光标、停止遥控移动约一秒后淡出，透明圆心、不抢焦点、不拦截点击。可选局部放大镜仍可在手机设置中开启。
- 更多面板调整为两行六键：Esc / 显示桌面 / 删除；向上滚动 / 向下滚动 / 回车。“删除”发送 Backspace。点击面板外关闭。
- 修正双指滚动刻度累积，保留备用滚动按钮供单手操作。
- 手机设置提供正常关机确认，未保存内容可能阻止关机；不强制结束应用。

## 下载与升级

- 普通用户选择 pillow-control-0.3.0-setup-x64.exe，包含离线 WebView2 安装程序。
- 免安装使用 pillow-control-0.3.0-portable-x64.zip；便携版运行仍需要 WebView2。
- v0.2.1 及更早版本没有内置更新入口，需手动安装 v0.3.0。后续稳定版提供完整签名更新资产后，安装版可在软件内更新。
- 更新签名不是 Windows 代码签名，安装程序仍可能出现 SmartScreen 提示。
- 请保留用户数据目录，不要先清理配对设置。网络地址变化时需重新访问电脑显示的新地址。

## 验证与已知限制

类型检查、前端/Rust 单元及集成测试、生产构建、本机 Tauri 更新检查与签名篡改拒绝已完成验证。鼠标、音量、中文输入、窗口切换、滚动、光环与断线释放已有本机 Windows 自动化验证。

尚未完成正式版本之间的真实升级安装及升级后设置保留验收；不能将签名验证通过视为安装验收通过。关机没有执行真实关机测试。实体手机手势/输入法、125%/150% 实际缩放与不同播放器仍建议真机核对。

只支持普通权限 Windows 桌面；不控制 UAC 安全桌面、锁屏或管理员窗口。HTTP/WS 遥控未加密，仅用于可信局域网。播放快捷键依赖当前窗口；光环/放大镜不保证覆盖独占全屏或受保护视频。

---

PillowControl turns your phone browser into a LAN trackpad and remote for Windows.
This release adds a cursor locator ring, signed update checking, and refined remote controls.
Older releases require a manual upgrade. Portable builds use manual downloads.
Full production upgrade installation and physical-device acceptance remain pending.
