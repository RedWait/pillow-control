# 触控板连续移动优化

2026-09-14：针对触控板移动不跟手反馈，保留上一轮 Logo 改动。

- 手机移动/滚动合并周期从 33ms 改为 16ms（约 60 次/秒），仍不等待上一条指令确认；保留小数位积累，避免细微移动被舍弃。
- Rust 接受 TCP 连接时启用 TCP_NODELAY，避免小型 WebSocket 确认包等待合并。没有取消鉴权、限速或断线释放。
- 依据：[Tokio TcpStream::set_nodelay 官方接口](https://docs.rs/tokio/latest/tokio/net/struct.TcpStream.html#method.set_nodelay)。TCP 设置本身不能保证解决 Wi-Fi 抖动。

本机旧版测试：Chromium 页面通过 HTTP 配对、WebSocket 发送 180 条实际 Windows 相对移动（交替 ±1 像素），33ms 发送间隔下确认往返 p50 1.3ms、p95 2.1ms、最大 8.4ms。本机环回网络没有复现用户所述 Wi-Fi 延迟，不能据此断言 TCP 合并就是用户端根因。已确认原前端只约 30 次/秒发送，现提高更新频率。

前端 40 项测试、类型检查及 Rust 12 项测试通过，包括实际接受连接的 TCP_NODELAY 检查。新旧测量原始结果保留在本地 artifacts/pointer-before.json 和 pointer-after.json（不提交）。

使用新安装包或便携版前退出旧版；手机刷新页面，重新配对。实体手机/Wi-Fi 的拖动手感仍需要实际复测。本变更没有对实体手机延迟作已解决的保证。
## 新版实测

新版 180 条移动在 16ms 发送间隔下，确认往返 p50 1.3ms、p95 2.1ms、最大 14.1ms；没有证据表明本机 RTT 降低。另用 Chromium 加载真实两版手机页面，通过相同的 3 秒正弦拖动轨迹触发触控板：旧版 83 条移动、约 27.58 次/秒、中位间隔 33.3ms；新版 164 条移动、约 54.47 次/秒、中位间隔 16ms。曲线转折处亚像素累积不会每周期都产生整数移动，因此不是严格每秒 62.5 条。命令实际进入 Windows SendInput，非日志模拟。该测量证明前端发送节奏改善，不替代实体手机的输入和网络体验。原始数据见 artifacts/touchpad-before.json 与 touchpad-after.json。
