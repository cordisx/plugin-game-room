# 游戏大厅客户端

CordisX 多来源游戏大厅：创建房间、发布自制玩法、邀请加入、派遣 Agent、回放与虚拟 Token 投入。
默认从独立主页面进入；Host 提供路由、控件、配置表单和页面生命周期。

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

默认 `npm run dev` 连接 8790 端口的本地真实积分服务，配置不含凭证。
先启动服务器；其他服务通过“设置 · 数据来源 → 管理来源与 Agent 配置”填写来源地址与握手返回的服务器 ID。
样例数据只在显式执行 `npm run dev:sample` 时启用，该模式不运行对局。
未登录时点击“加入”会打开 Host 安全凭证框，验证账户后自动继续加入。
游戏账户和经济账户分别连接。
账户与会话由服务器提供；凭证不保存于插件配置、不传给模型或游戏场景。

上传的规则及渲染代码只在服务器受限运行器执行。客户端通过公共 `restrictedContent`
显示声明式场景。候选 SDK、组件预览、服务端测试与原生实测是不同验证范围。

[实现与验证记录](../docs/client.md) · [服务端 API](../docs/server-api.md)
