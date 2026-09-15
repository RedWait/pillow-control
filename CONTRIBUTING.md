# 参与贡献 / Contributing

欢迎通过 [Issues](https://github.com/RedWait/pillow-control/issues)报告问题或建议。请提供版本、系统和浏览器、复现步骤、预期与实际结果。不要上传配对码、令牌或私人输入内容。较大改动请先开 Issue 讨论。

Fork 后从最新代码建立分支，保持修改范围清晰。按 [开发文档](docs/DEVELOPMENT.md)运行相关检查；PR 说明改了什么、为何修改、验证了哪些层次，以及尚未测试的设备。不要把模拟传输或浏览器视口描述为真实系统操作或手机真机验证。

必须保留配对鉴权、控制白名单、单活动连接、断线释放和不重放旧操作；不要引入任意 shell、默认管理员权限或外部脚本依赖。文档改动请同步中文和英文 README，截图使用演示数据并说明版本。

---

Please use [Issues](https://github.com/RedWait/pillow-control/issues) for bugs and suggestions. Include the version, OS/browser, reproduction steps, and expected versus actual behavior. Never attach pairing codes, tokens, or private input. Discuss larger changes before implementing them.

Fork the repository and create a focused branch. Follow the [development guide](docs/DEVELOPMENT.md) (Chinese), run relevant checks, and state exactly what was tested in your PR. Distinguish simulated transport and browser viewports from real Windows input and physical-phone testing.

Preserve authentication, command allowlists, single-session control, release-on-disconnect, and no replay after reconnection. Do not add arbitrary shell execution, default elevation, or external scripts. Keep both READMEs aligned; use clearly identified demo data in screenshots.
