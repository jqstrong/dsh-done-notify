# dsh-done-notify · 运行完成通知

> A DeepSeek Harness (DSH) plugin that notifies you when a conversation finishes running or waits for your choice — through a selectable **in-page notice card** and/or a **desktop system notification**, configured on a dedicated **Settings → Run notifications** page.

DSH 插件（bundle）：会话跑完、或需要你做选择时给出提示，解决「跑完了却不知道」「卡在等选择」的问题；**设置 → 运行通知** 里可以选择用哪种方式提醒。

- **页面内提示卡片**：DSH 窗口右下角弹出卡片，带会话 id 尾号；点击打开该会话，悬停暂停消失，到时自动收起。
- **桌面系统通知**：Windows 桌面右下角的系统通知（Web Notification），点击打开会话并尝试聚焦窗口；窗口不在前台时通知横幅会保持显示，等你处理；通知也会留在通知中心，直到手动清除。
- 两种通道**可以分别在设置里开关**（都开、只开其一、都关都可以）。
- **需要你选择时提醒**：会话在等待选择 / 确认 / 审批时也会提醒（可单独关闭）；回答后对应的「等待选择」通知会自动关闭。
- 窗口不在前台时收到通知、之后回到 DSH 时，会自动切到该通知对应的会话（3 分钟内有效）。
- 设置项立即生效，保存在 DSH 配置档案里，重启后仍然有效。

## 功能

| 场景 | 页面内卡片 | 桌面系统通知 |
| --- | --- | --- |
| 会话运行结束（无论窗口是否在前台） | ✅（通道开启时） | ✅（通道开启且已授权时） |
| 你正看着的会话结束，且关闭了「当前会话完成时也提示」 | ❌ | ❌ |
| 会话等待你选择 / 确认 / 审批（「需要我选择时提醒」开启时） | ✅ | ✅ |
| 子代理（subagent）会话结束或等待选择 | ❌（开启「子代理会话也提示」后 ✅） | 同左 |
| 对应通道开关关闭 / 通知权限被拒绝 | — | ❌ |
| 多个事件几乎同时发生 | 最多堆叠 4 条，保留最新的 | 每个会话一条（同会话同类型覆盖） |

## 设置 → 运行通知

打开 **设置**（侧栏底部齿轮，或 `Ctrl+,`），导航中会多出 **「运行通知」**（英文界面为 *Run notifications*）：

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| 页面内提示卡片 | 开 | 在 DSH 窗口右下角弹出提示卡片 |
| 桌面系统通知 | 开 | 在桌面右下角的系统通知区域提醒（需要通知权限） |
| 需要我选择时提醒 | 开 | 会话等待你的选择、确认或审批时也提醒 |
| 当前会话完成时也提示 | 开 | 关闭后，只有后台会话跑完才提示；你正看着的会话结束不再弹卡片 |
| 子代理会话也提示 | 关 | 开启后 subagent 运行结束 / 等待选择同样提示 |
| 提示显示时长 | 12 秒 | 页面内卡片 6 / 12 / 20 / 30 秒可选（配置文件可写 3–60 的整数） |
| 通知权限 | — | 显示「已授权 / 尚未授权 / 已被拒绝 / 不支持」，可主动申请授权 |
| 测试通知 | — | 按当前开启的通道立刻发一条测试提示 |

设置**立即生效**，由 Host 写入当前 DSH 配置档案的 patch 层（`<profile>/cordis.patch.yml`），重启后仍然有效；也可以直接编辑该文件：

```yaml
- id: done-notify
  name: "@local/dsh-done-notify"
  config:
    notifyInApp: true
    systemNotifications: true
    notifyWhenNeedsInput: true
    notifyWhenFocused: true
    notifySubagents: false
    toastLifetimeSeconds: 12
```

插件行带有 `Config` schema（6 个 `volatile` 字段），因此设置页走官方配置表单管线（`ctx.configForms` + Host `settings` 服务，revision 保护写入）；插件管理页里也会自动生成同一份表单作为备用入口。

### 关于「桌面右下角的应用通知」

桌面级的自绘通知窗口（在应用窗口之外、屏幕右下角浮一个由插件自己渲染的卡片）**无法通过 DSH 插件公开 API 实现**：客户端插件运行在页面里，桌面壳没有向插件暴露「创建/控制独立窗口」的 IPC。插件能用的桌面级通道就是系统通知（Web Notification，即 Windows 通知中心里的那条）——它本来就出现在桌面右下角，且可点击回到会话。所以设置里提供「页面内卡片 / 桌面系统通知」两个通道供选择；如果以后桌面壳开放窗口接口，可以再补一个自绘桌面通知通道。

## 安装

前置：DSH Desktop / Web 0.2.1-rc.2 测试通过。插件是标准的 DSH bundle（`dsh.bundle.patch` + `dsh.client`），Host 半只提供 `Config`，界面与通知全部在客户端。

```bash
git clone https://github.com/jqstrong/dsh-done-notify.git
cd dsh-done-notify
pnpm install          # 安装 Host Config 需要的 @deepseek-ai/schemastery
```

然后用 DSH 的插件管理安装本目录（`plugin_manager` 的 `install_bundle`，target 为本目录绝对路径），或在 profile 中把它作为本地依赖链接。安装后如果页面没有立刻出现新导航项，刷新一次页面即可。

> **重要：升级 / 重新安装后请刷新一次 DSH 页面（或重启 DSH）。** 已打开的页面会继续运行启动时加载的客户端模块，浏览器不会因为 bundle 重新安装而自动换成新代码；只有开发时的文件改动（HMR）或刷新页面/重启才会加载新版本。改完包后如果发现行为还是旧的，先刷新一次再判断。

卸载：`plugin_manager` 的 `remove_bundle`（target `@local/dsh-done-notify`）。

> `@local/*` 是本机 bundle 的命名惯例；要发布到别处时，同步修改 `package.json` 的 `name`、`client.js` 的模块 id、`cordis.patch.yml` 与 README 即可（行 id `done-notify` 同时是设置命名空间，改名需要一并调整）。

## 实现要点

- **数据源**：Client 端已有的会话状态源（`useSessionStatus` / `useSessions` 标准 props，由官方 `@deepseek-ai/dsh-client-ui-session` 提供），包含 `running` 与 `pendingInteraction`。不轮询、不订阅全量会话事件、不读 DOM。
- **完成判定**：只关心 `running: true → false` 的跳变；用会话列表行区分主视图 / 子代理；焦点状态只影响「正在看的会话是否提示」和隐藏时卡片不提前消失。
- **等待判定**：`pendingInteraction` 从无到有、或换成一个新的交互对象时提醒一次；同一个交互在状态重发时不会重复提醒。
- **通道与点击**：`notifyInApp` 与 `systemNotifications` 独立控制；系统通知点击会打开对应会话、调用 `window.focus()` 并延迟重试。点击能否回调依赖 Notification 对象存活——Electron 里被 GC 的通知会丢失 click 处理器，而 `close` 事件会在通知移入 Windows 通知中心时触发，所以**不能在 `close` 里释放引用**。窗口不在前台时用 `requireInteraction` 让横幅保持到用户处理；另记录一个「待返回会话」，窗口重新获得焦点且 3 分钟内未点击时自动切过去。
- **渲染位置**：卡片注册在 `shell.overlay`（全窗口浮动层，本身点击穿透，只有卡片接管鼠标事件）；设置页注册在 `settings.section`（设置导航页签）。
- **配置**：Host `index.js` 导出 `Config`（6 个 `volatile` 字段），客户端通过 `ctx.configForms` 读取实时值并用 revision 保护写入；命名空间为 Loader 行 id `done-notify`，对嵌套（`include:` 前缀）命名空间做了回退解析。
- **样式**：全部使用 `--dsw-alias-*` / `--dsw-focus-ring-*` 主题 token，跟随深浅色与字号设置；开关控件按官方样式重写，不导入任何 Harness Client 包，也不替换应用根节点。
- **健壮性**：定时器、监听器、样式表、权限监听全部随插件 effect / 条目卸载清理；系统通知权限、Permissions API、`uiWorkspace` 服务均为可选能力，缺失时降级而不是报错。系统通知的 `tag` 使用会话 id 的短哈希（≤34 字符），避开 Electron/Windows 11 的 tag 长度 bug。

## 开发与校验

```bash
pnpm install
node check.mjs      # 或 pnpm check
```

`check.mjs` 在 Node VM 里用最小的 React hooks / DOM / 定时器 / Notification / configForms 桩运行真实的 `client.js`，覆盖：空闲跳变检测、等待选择检测、主视图与子代理过滤、失焦与隐藏判定、通道分别开关、系统通知文案 / tag / 点击、通知引用保留、堆叠上限、可配置的提示时长、悬停暂停、点击 / 键盘打开、关闭按钮、权限四态、测试通知、设置页加载 / 就绪 / 只读、开关与时长写入、写入失败提示、嵌套命名空间回退、中英文案。**这是分支与数值检查，不是视觉验证。**

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：`Config` schema（6 个 volatile 字段）+ 空 `apply` |
| `client.js` | 客户端半：状态监听、通道选择、toast、系统通知、权限、设置桥接、设置页、样式 |
| `cordis.patch.yml` | bundle 补丁：插入 `done-notify` 行 |
| `locale/*.json` | 插件列表里的标题 / 描述 |
| `icon.svg` | 原创图标（铃铛 + 对勾） |
| `check.mjs` | 逻辑自检 |

## 已验证 / 未验证

已验证（本机，无浏览器控制能力下能取得的最强证据）：

- Host 配置表单被正式提供（`Config.listConfigs` 返回 `status: "schema"`，6 个字段带 `x-cordis.volatile`）。
- 设置页与通知器均注册成功（`Slots.listSubTree` 的 `settings.section` 与 `shell.overlay` 中对应条目 `active: true`）。
- 设置写入端到端可用：客户端桥接写入后 `<profile>/cordis.patch.yml` 出现对应 config 段。
- 客户端 HMR 生效（修改注册顺序无需刷新页面即生效）；`node check.mjs` 全部断言通过。
- 1.0.1 修复：系统通知不再只在窗口失焦时发送，真实运行结束与测试按钮走同一条发送路径。
- 1.0.3 修复：Electron 在 Windows 11 上会丢弃 `tag` 长度超过 34 字符的 Web Notification（[electron/electron#40433](https://github.com/electron/electron/issues/40433)），真实通知此前用约 60 字符的 tag 因此完全不显示；现改为会话 id 的 32 位哈希（`dsh-dn-xxxxxxxx`，14 字符）并开启 `renotify`。
- 1.1.0 新增：通道分别开关、等待选择提醒、保留 Notification 引用修复点击回调（[electron/electron#29461](https://github.com/electron/electron/issues/29461)）。
- 1.2.0 修复：`close` 事件可能在通知被移入 Windows 通知中心时触发，旧代码在 `close` 里释放引用，导致之后点击时对象已被回收、回调丢失；现在只在点击/出错/主动关闭时释放。窗口不在前台时使用 `requireInteraction` 让横幅保持可点击；回到 DSH 时自动切到通知对应的会话（3 分钟内）。

未验证：

- 视觉与交互观感（截图确认设置页排版、开关配色、toast 位置）。
- 点击系统通知后窗口是否能被系统/桌面壳拉到前台：代码会打开对应会话、调用 `window.focus()` 并延迟重试，且保留了通知引用；但如果 DSH 窗口处于**最小化**状态，页面侧没有恢复窗口的 API（桌面壳未向插件暴露），可能只能把会话切换好、等你自己点任务栏恢复。Electron 的 Windows 通知中心（Action Center）点击回传也有已知缺陷（[electron/electron#29461](https://github.com/electron/electron/issues/29461)），所以窗口不在前台时通知横幅会用 `requireInteraction` 保持显示，优先点横幅。
- macOS / Linux 与不同 DSH 版本；DSH 的 Client 内部 API 可能随版本演进，升级后建议重新跑 `node check.mjs`。

## 常见问题

- **更新 / 重新安装后行为没变**：已打开的页面会继续运行启动时加载的客户端模块。刷新一次页面（`Ctrl+R`）或重启 DSH，才会换成新代码；开发时的文件改动（HMR）除外。
- **没有收到系统通知**：先在「设置 → 运行通知」确认「桌面系统通知」开启、权限为「已授权」；再点「发送测试」确认通道；若测试也没有 Windows 弹窗，检查 Windows 通知中心（`Win+N`）与「专注助手 / 勿扰模式」设置。插件发出的通知不会自动清除，会留在通知中心。
- **点击系统通知没有反应**：请确认运行的是 1.2.0+。1.2.0 修掉了「通知移入通知中心时释放引用，随后点击时对象已被回收」的问题，并在窗口不在前台时让横幅保持显示（`requireInteraction`），**优先点击横幅**而不是通知中心里的条目——Electron 在 Windows 通知中心的点击回传有已知缺陷（[electron/electron#29461](https://github.com/electron/electron/issues/29461)）。如果窗口是最小化状态且点了横幅仍不出现，受限于页面没有恢复窗口的 API，可能需要点任务栏图标；此时回到窗口会自动切到通知对应的会话。
- **不想在看着会话时被打扰**：关闭「当前会话完成时也提示」——该会话在前台时不再提示，后台会话结束仍会通知；也可以直接关掉「页面内提示卡片」通道。

## Changelog

- **1.2.0** — 修复点击系统通知无反应：`close` 事件会在通知移入 Windows 通知中心时触发，旧代码据此释放引用，导致之后点击时 Notification 已被回收、click 回调丢失；现在只在点击/错误/主动关闭时释放，窗口不在前台时用 `requireInteraction` 让横幅保持可点击，并在回到 DSH 时自动切到通知对应会话（3 分钟内）。等待选择的系统通知在回答后自动关闭。
- **1.1.0** — 新增「页面内提示卡片 / 桌面系统通知」两个通道可分别开关；新增「需要我选择时提醒」（`pendingInteraction` 检测）；首次尝试保留 Notification 引用以避免点击回调丢失（[electron/electron#29461](https://github.com/electron/electron/issues/29461)）。
- **1.0.3** — 修复真实运行结束的系统通知不显示：通知 tag 超过 34 字符会被 Electron/Windows 11 丢弃（[electron/electron#40433](https://github.com/electron/electron/issues/40433)），改用会话 id 哈希出的短 tag 并开启 `renotify`。
- **1.0.2** — 系统通知不再在 15 秒后主动关闭，错过横幅后仍可在 Windows 通知中心找到；README 补充升级后需刷新页面、通知排查等说明。
- **1.0.1** — 系统通知改为每次运行结束都发送（不再只在窗口失焦时）；设置页排版、焦点样式、时长归一化与若干健壮性修复；补充 LICENSE、仓库元数据与 README。
- **1.0.0** — 首个版本：应用内提示、系统通知、设置页、逻辑自检。

## License

[MIT](LICENSE) © 2026 jqstrong
