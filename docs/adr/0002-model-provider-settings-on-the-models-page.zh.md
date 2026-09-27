# ADR 0002: 把提供方的设置卡片放到 Models 页面底部

[English](0002-model-provider-settings-on-the-models-page.md) | 中文

## 状态

已接受 —— 2026-09-25

## 背景

这张卡片原本位于 **Settings → Plugins**，注册进以提供方设置命名空间为 key 的 `settings.plugin.item` 座位。0.1.7 的设置改版不仅移除了该去处，也改变了「插件设置」本身：

- Settings → Plugins 分区现在是 **Built-in plugins**：围绕只读清单标签页的外壳。`settings.plugin.item` 已不由任何随包发布的包声明，因此向它注册会被接受、但不会渲染 —— 失败表现是卡片静默消失，而非报错。
- 插件不再「安装设置段」。`settings.installSection` 已删除：settings 服务按条目 id（`llm-opencode-go`）投影命名空间 —— 但**仅当 Config schema 至少声明一个 `.volatile()` 字段**（`volatileForm`）。一个都没有时，插件就没有设置命名空间，`configForms.get(NS)` 报告不可用，卡片什么都不渲染。自带页面的插件随后注册 `settings.configure({ auto: false })`；而对 volatile 字段的写入会**就地提交到运行中的 Config**（发出 `loader/volatile-update`），而不是重新挂载条目。
- `apply` 现在收到的是 Schemastery Config：其字段是活引用（`config.apiRoot.get()`），而不是普通对象。本插件此前按普通字段读取，所有值都退化为 schema 默认值：设置文档被静默忽略，而已被删除的 `installSection` 调用在其 `ctx.inject` 子 fiber 中抛错。
- Models 页面为仓库之外分发的插件声明了两个座位：`settings.models.provider-card`（以提供方行的设置命名空间为 key，在每张渲染目录行的卡片上分发）与 `settings.models.footer`（提供方行与添加控件之后的有序列表）。
- 对这条路由而言 `provider-card` 座位 **不可达**。`llm-pi-ai` 向 configurable-provider 目录声明了整份 pi-ai 提供方目录 —— 裸挂载会提供它附带的全部提供方，已配置时也仍声明整份目录 —— 其中包含 `opencode-go`。Host 会拒绝同一提供方 id 的第二次声明（all-or-nothing，因此本插件自己的条目被丢弃），Models 页面把该行与 `llm-pi-ai` 命名空间关联，于是座位以本插件无法占有的 key 分发。更糟的是，那个 pi-ai 条目是休眠的：其 `providers.opencode-go` profile 无法解析，因此该行甚至不在座位所属的已保存行列表里。

结论：旧座位已死，provider-card 座位不可寻址，而页面仍需要一个始终渲染的位置来放这个提供方的设置。

## 决定

把提供方的设置界面放在 **Models 页面底部（footer）**：

- `lib/index.js` 通过活 Config 引用读取配置（`fieldOf`），因此部署的端点、刷新策略、请求头、凭据引用、图像预算与模型覆盖项真正到达路由。普通对象仍被接受，以保证直接调用 `apply` 与本仓库的 host 测试可用。
- 卡片读写的字段 —— `apiRoot`、`refreshIntervalMs`、`models`、`refreshEpoch`、`apiKeyEnv`、`displayName` —— 声明为 `.volatile()`。这既是命名空间得以存在的前提，也界定了表单可写的范围：settings 服务会拒绝非 volatile 路径。`providerId` 与仅供部署使用的字段保持普通，改动它们会重新挂载条目。
- 由于 volatile 写入就地提交，`apply` 订阅 `loader/volatile-update` 并重建由旧值派生的东西：目录、刷新器与缓存的 provider 实例。重新宣告路由才能让变更后的模型列表进入模型选择器，同一条路径也让 `refreshEpoch`（卡片的「立即刷新目录」）生效。
- 用 0.1.7 的策略 seam 取代已删除的 `installSection` ——
  `ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))`
  —— 因为本插件自带编辑器。路由自身对不受支持 `api` 的检查一并去掉：Config schema 的 union 已经拒绝该值。
- 仍尽力把路由声明到 configurable-provider 目录：在没有其他插件占有该 id 时是正确的，在 `llm-pi-ai` 占有时会以 `DUPLICATE_DIRECTORY` 被拒。该拒绝是预期情况，以 info 级别记录，卡片不依赖该行。
- `lib/client.js` 以自身条目 id 与 locale 注册进 `settings.models.footer`。该座位是有序列表，始终渲染，且不需要目录行。
- 卡片保留自己的 `configForms` scope、凭据 store、暂存编辑、校验与 Save；Models 页面自带的编辑器从不触碰该命名空间。它重新绘制自己的卡片外框（这是页面级条目，而非行内折叠区），标题取自命名空间解析出的 `displayName`，缺失时回退到随包文案。
- 不再保留 `settings.models.provider-card` 注册：该行以 `llm-pi-ai` 分发，注册永远不会渲染；而做「按行 id 守卫的族级注册」只会为每一行 pi-ai 挂载一个无用的实例。

## 后果

- 卡片位于 Settings → Models 页面底部，而不是 OpenCode Go 行内。语境弱一些，但保证渲染，而 provider-card 座位做不到这一点。
- 这条路由在 Models 页面没有自己的提供方行：目录条目属于 `llm-pi-ai`，而它针对 `opencode-go` 的 profile 处于休眠。若用户采用那行休眠条目，得到的 pi-ai profile 永远无法注册其路由，因为 `opencode-go` 适配器由本插件占有。
- 配置编辑现在真正生效。改动之前插件只按 schema 默认值服务请求，用户设置的 `apiRoot`、请求头或模型覆盖项都没有效果。
- `tests/host.smoke.mjs` 用真实的 `Config` 挂载非默认值，断言它们到达路由、目录条目与适配器目录；其 stub 不含 `installSection`，因此回退到已删除 seam 的改动会立即失败。
- ADR 0001 中「卡片位于 Settings → Plugins」的后果由本 ADR 取代；路由本身的决定不变。
