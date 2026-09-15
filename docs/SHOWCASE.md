# 展示素材与 README 核验

## 素材

`docs/assets/` 中的图片由 `node scripts/capture-readme.mjs` 生成（先运行 `npm run build:frontend`）。脚本仅在本地提供已构建页面，并注入文档预览数据，不启动 Rust 控制服务、不改真实配置、不执行系统输入。桌面 760×680、手机 390×650，按 2× 像素输出 PNG，README 等比显示。

- `logo.png`：复用项目现有安装程序高对比图标，保证 GitHub 浅色背景可见。
- `desktop-pairing.png`：电脑等待配对。
- `mobile-remote.png`：已连接完整主界面。
- `mobile-pairing.png`、`mobile-more.png`：次要面板。

演示地址 `192.0.2.10`、配对码 `123456`；二维码也由真实组件根据演示地址生成。图片不是实际网络连接或手机真机验收证据。没有使用 AI 生成界面、录屏或设备框。

## 参考研究（2026-09-15）

实际浏览 README 并通过 GitHub API 确认未归档及近期更新：

| 项目 | 当日 Star（约） | 最近推送 | 采用的信息结构 |
| --- | --- | --- | --- |
| [LocalSend](https://github.com/localsend/localsend) | 91,452 | 2026-09-14 | 截图、下载在开发章节之前，按产物组织下载 |
| [Flow Launcher](https://github.com/Flow-Launcher/Flow.Launcher) | 15,565 | 2026-09-13 | 安装版/便携版直接入口，限制靠近安装说明 |
| [RustDesk](https://github.com/rustdesk/rustdesk) | 123,554 | 2026-09-15 | 多语言、FAQ、贡献指南入口清楚 |

仅借鉴信息分层，没有复用对方品牌素材、文案或徽章。Star 与时间是当日快照。

## 事实来源

版本来自 package.json、Cargo.toml 和 tauri.conf.json；分发策略来自 Tauri 的 currentUser 与 offlineInstaller 配置及 package-portable 脚本。首次核验的已发布版本为 v0.2.0（GitHub API 确认三个附件）。用户随后授权同步发布 v0.2.1，README 随新版本发布。

配对、自启、单活动页面及断线处理核对 security.rs、service.rs、main.rs、connection.ts 与 docs/SECURITY.md、AUTOCONNECT.md。MIT 核对根 LICENSE。没有 CI 徽章，也没有承诺尚未实测的平台。

旧技术内容整理到 DEVELOPMENT.md、TROUBLESHOOTING.md；历史验证记录保留原版本与时间，不覆盖为新版本结果。

中英文 390/1280 px 检查采用 GitHub Markdown API 输出及本地 GitHub 风格样式，图片无缺失、页面无横向溢出；不等同于完整 GitHub 网站 UI 验证。相对路径、显式锚点及 npm 命令均通过检查。
