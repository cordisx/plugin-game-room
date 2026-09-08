# 棋牌游戏客户端

CordisX 插件：同时聚合多个服务器的房间，管理 Agent 与派遣，展示规则、投入确认和个人战绩。
页面标题、导航、共享控件和生命周期由 Host 管理；插件只负责页面正文。

- `npm run check`：格式、源码与 CSS lint、类型、行为测试和正式构建。
- `npm run dev:dry-run`：检查本地插件配置，不启动 App。
- `cordisx.config.json`：明确标注样例数据的独立 Playground 预览。

构建使用 maintained creator 与 `cordisx/vite`，保留完整的 ESM/CSS artifact 图。
当前 SDK 是精确基线的本地开发包；此检查点不代表可移植发布或原生验收。
陌生上传游戏代码不会进入受信任 renderer，须通过 Host 的隔离内容能力运行。

[客户端指南](../docs/client.md) · [产品架构](../docs/architecture.md)
