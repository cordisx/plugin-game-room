# 游戏大厅客户端

CordisX 多来源游戏大厅：创建房间、发布自制玩法、邀请加入、派遣 Agent、回放与虚拟 Token 投入。
Header、路由标签、控件、配置表单和页面生命周期均由 Host 提供。

从 `client/` 执行：

```sh
node scripts/prepare-sdk.mjs
npm ci --ignore-scripts
npm run check
npm run dev:dry-run
```

SDK 脚本以固定提交构建候选 Host/Protocol，产物与 provenance 留在忽略的 `.cache/`。
使用 Node 24.14.1、npm 11.11.0、Git 与仓库内相邻的 `agents/` 复现已验证的归档哈希。
脚本直接委托固定 Host 提交的源码构建 recipe，先构建并核验完整 Channel/Proxy，再打包；
不提前对 Host 运行 npm ci，不递归安装 Git 开发依赖，每次使用新的构建目录。
构建保留 `dist/runtime` 中完整索引 ESM/CSS 图。

默认预览配置明确使用样例数据。真实使用时，通过“设置 · 数据来源 → 管理来源与 Agent 配置”
填写多个来源与 Agent，关闭 `sample`。游戏账户和经济账户分别在 Host 安全凭证框中连接。
账户与会话由服务器提供；凭证不保存于插件配置、不传给模型或游戏场景。

上传的规则及渲染代码只在服务器受限运行器执行。客户端通过公共 `restrictedContent`
显示声明式场景。候选 SDK、组件预览、服务端测试与原生实测是不同验证范围。

[实现与验证记录](../docs/client.md) · [服务端 API](../docs/server-api.md)
