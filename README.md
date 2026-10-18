# dsh-done-notify · 运行完成通知

> A DeepSeek Harness (DSH) plugin that notifies you when a conversation finishes running — an in-app toast in the corner of the window, an OS-level notification while the window is minimized or unfocused, and a dedicated **Settings → Run notifications** page to configure it.

DSH 插件（bundle）：会话从「运行中」变为空闲时给出提示，解决「跑完了却不知道」的问题；并在**设置**里提供 **「运行通知」** 配置页。

- 应用内提示：窗口右下角弹出卡片，带会话 id 尾号；点击打开该会话，悬停暂停消失，到时自动收起。
- 系统通知：窗口最小化 / 失焦 / 页面隐藏时，额外发一条原生系统通知（Web Notification），点击回到会话。
- 设置页：开关、提示时长、通知权限状态、一键测试通知，全部即时生效并保存在 DSH 配置档案里。

## 功能

| 场景 | 应用内提示 | 系统通知 |
| --- | --- | --- |
| 后台会话运行结束，你正在应用里看别的页面 | ✅ | ❌ |
| 会话运行结束，但窗口已最小化 / 失焦 / 页面切到后台 | ✅（回来时可见，不会提前消失） | ✅（已授权时） |
| 你正看着这个会话，它运行结束 | ✅（可在设置中关闭） | ❌ |
| 子代理（subagent）会话结束 | ❌（可在设置中开启） | ❌ |
| 多个会话几乎同时结束 | 最多堆叠 4 条，保留最新的 | 每个会话一条（同会话覆盖） |

## 设置 → 运行通知

打开 **设置**（侧栏底部齿轮，或 `Ctrl+,`），导航中会多出 **「运行通知」**（英文界面为 *Run notifications*）：

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| 当前会话完成时也提示 | 开 | 关闭后只有后台会话跑完才提示；你正看着的会话结束时不再弹卡片 |
| 系统通知 | 开 | 窗口最小化 / 失焦时发送系统级通知（需要通知权限） |
| 子代理会话也提示 | 关 | 开启后 subagent 运行结束同样提示 |
| 提示显示时长 | 12 秒 | 6 / 12 / 20 / 30 秒可选（配置文件里可写 3–60 的整数） |
| 通知权限 | — | 显示「已授权 / 尚未授权 / 已被拒绝 / 不支持」，可主动申请授权 |
| 测试通知 | — | 立刻发一条应用内提示；系统通知开启且已授权时同时发送系统通知 |

设置**立即生效**，由 Host 写入当前 DSH 配置档案的 patch 层（`<profile>/cordis.patch.yml`），重启后仍然有效；也可以直接编辑该文件：

```yaml
- id: done-notify
  name: "@local/dsh-done-notify"
  config:
    notifyWhenFocused: true
    systemNotifications: true
    notifySubagents: false
    toastLifetimeSeconds: 12
```

插件行带有 `Config` schema（4 个 `volatile` 字段），因此设置页走官方配置表单管线（`ctx.configForms` + Host `settings` 服务，revision 保护写入）；插件管理页里也会自动生成同一份表单作为备用入口。

## 安装

前置：DSH Desktop / Web 0.2.1-rc.2 测试通过。插件是标准的 DSH bundle（`dsh.bundle.patch` + `dsh.client`），Host 半只提供 `Config`，界面与通知全部在客户端。

```bash
git clone https://github.com/jqstrong/dsh-done-notify.git
cd dsh-done-notify
pnpm install          # 安装 Host Config 需要的 @deepseek-ai/schemastery
```

然后用 DSH 的插件管理安装本目录（`plugin_manager` 的 `install_bundle`，target 为本目录绝对路径），或在 profile 中把它作为本地依赖链接。安装后如果页面没有立刻出现新导航项，刷新一次页面即可。

卸载：`plugin_manager` 的 `remove_bundle`（target `@local/dsh-done-notify`）。

> `@local/*` 是本机 bundle 的命名惯例；要发布到别处时，同步修改 `package.json` 的 `name`、`client.js` 的模块 id、`cordis.patch.yml` 与 README 即可（行 id `done-notify` 同时是设置命名空间，改名需要一并调整）。

## 实现要点

- **数据源**：Client 端已有的会话状态源（`useSessionStatus` / `useSessions` 标准 props，由官方 `@deepseek-ai/dsh-client-ui-session` 提供）。不轮询、不订阅全量会话事件、不读 DOM。
- **判定**：只关心 `running: true → false` 的跳变；用会话列表行区分主视图 / 子代理；用 `document.hidden` + `document.hasFocus()` 区分窗口是否失焦。
- **渲染位置**：提示卡片注册在 `shell.overlay`（全窗口浮动层，本身点击穿透，只有卡片接管鼠标事件）；设置页注册在 `settings.section`（设置导航页签）。
- **配置**：Host `index.js` 导出 `Config`（4 个 `volatile` 字段），客户端通过 `ctx.configForms` 读取实时值并用 revision 保护写入；命名空间为 Loader 行 id `done-notify`，对嵌套（`include:` 前缀）命名空间做了回退解析。
- **样式**：全部使用 `--dsw-alias-*` / `--dsw-focus-ring-*` 主题 token，跟随深浅色与字号设置；开关控件按官方样式重写，不导入任何 Harness Client 包，也不替换应用根节点。
- **健壮性**：定时器、监听器、样式表、权限监听全部随插件 effect / 条目卸载清理；系统通知权限、Permissions API、`uiWorkspace` 服务均为可选能力，缺失时降级而不是报错。

## 开发与校验

```bash
pnpm install
node check.mjs      # 或 pnpm check
```

`check.mjs` 在 Node VM 里用最小的 React hooks / DOM / 定时器 / Notification / configForms 桩运行真实的 `client.js`，覆盖：空闲跳变检测、主视图与子代理过滤、失焦与隐藏判定、系统通知文案与点击、堆叠上限、可配置的提示时长、悬停暂停、点击 / 键盘打开、关闭按钮、权限四态、测试通知、设置页加载 / 就绪 / 只读、开关与时长写入、写入失败提示、嵌套命名空间回退、中英文案。**这是分支与数值检查，不是视觉验证。**

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：`Config` schema（4 个 volatile 字段）+ 空 `apply` |
| `client.js` | 客户端半：状态监听、toast、系统通知、权限、设置桥接、设置页、样式 |
| `cordis.patch.yml` | bundle 补丁：插入 `done-notify` 行 |
| `locale/*.json` | 插件列表里的标题 / 描述 |
| `icon.svg` | 原创图标（铃铛 + 对勾） |
| `check.mjs` | 逻辑自检 |

## 已验证 / 未验证

已验证（本机，无浏览器控制能力下能取得的最强证据）：

- Host 配置表单被正式提供（`Config.listConfigs` 返回 `status: "schema"`，字段带 `x-cordis.volatile`）。
- 设置页与通知器均注册成功（`Slots.listSubTree` 的 `settings.section` 与 `shell.overlay` 中对应条目 `active: true`）。
- 设置写入端到端可用：客户端桥接写入后 `<profile>/cordis.patch.yml` 出现对应 config 段。
- 客户端 HMR 生效（修改注册顺序无需刷新页面即生效）；`node check.mjs` 全部断言通过。

未验证：

- 视觉与交互观感（截图确认设置页排版、开关配色、toast 位置）。
- 该桌面壳是否把 Web Notification 透传为 Windows 原生 toast；若被环境屏蔽，应用内提示仍正常工作。
- macOS / Linux 与不同 DSH 版本；DSH 的 Client 内部 API 可能随版本演进，升级后建议重新跑 `node check.mjs`。

## License

[MIT](LICENSE) © 2026 jqstrong
