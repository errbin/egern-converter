# Loon `$environment.params` 原生可用性审计

第九轮穷尽复核日期：2026-11-10。范围限定为本工作区的 `egern-upstream`、`egern-core`、`egern-skills` 和 `egern-site`；没有联网补充材料。

## 正式结论

在本工作区可审计的 Egern 资料中，没有找到官方类型定义、官方文档副本或原生脚本证据，能够证明 Egern 原生 `ctx` 存在“动态节点、当前策略或规则运行上下文参数”的等价能力。因此：

- `$environment.params` 继续按未知宿主输入拒绝，错误保持为“未适配 API 成员：`$environment.params`”。
- 不把它映射到 `ctx.env`、`ctx.device`、`ctx.network`，也不把其中的节点名当作请求选项 `policy`。
- 该能力归入“既定策略拒绝”，不按脚本名、作者或 URL 开特例。
- 只有取得官方 API 字段、官方类型定义或可复核的 Egern 原生运行证据后，才重新开启通用映射研究。

这是项目证据规则下的正式结论，不是“已证明 Egern 永远不存在该能力”。未来官方资料出现后，必须以通用数据流规则和双向回归替换本结论。

## 第九轮穷尽复核记录

本轮重新检索四个资料库的全部文档、references、脚本快照和类型定义，结论与第八轮一致：**工作区内没有找到任何 Egern 原生 `ctx` 字段，可以作为动态节点、当前策略或规则运行上下文参数的映射出处**。因此没有可写的“来源字段 → 原生字段”映射；该能力正式归入“既定策略拒绝”。

复核范围与可重复事实：

- `egern-upstream` 有 486 个 Markdown、907 个 JavaScript 文件；`egern-upstream/README.md:3` 说明该目录只保存上游原始字节和抓取快照。
- `egern-core` 有 2 个 Markdown、0 个 JavaScript 文件；`egern-core/README.md:3` 说明它只承担上游抓取、同步与网站构建。
- `egern-skills` 有 30 个 Markdown、0 个 JavaScript 文件；全部 references 与交接文档已纳入检索。
- `egern-site` 只有 1 个 Markdown、0 个 JavaScript 文件；`egern-site/README.md:3` 说明它只存放构建后的静态网站。
- 四个资料库中的 `.ts`、`.d.ts`、`.d.mts`、`.d.cts` 文件数量均为 0，不存在可引用的 Egern 原生类型定义。

关键证据与边界：

- `egern-skills/skills/egern-native-conversion/references/原生API.md:5` 说明请求、响应、定时、小组件、网络等入口各有不同上下文，不能无条件访问所有字段。
- `原生API.md:15` 列出参数、语言、脚本名和 cron 的原生位置是 `ctx.env`、`ctx.app.language`、`ctx.script.name`、`ctx.cron`；`:26` 明确 `ctx.env` 是字符串键值配置，不能冒充动态节点参数。
- `原生API.md:17` 把网络/IP 信息指向 `ctx.device` 与 `ctx.lookupIP`；这些是网络环境或地址查询能力，不是当前节点、当前策略或规则上下文。
- `egern-skills/skills/egern-native-conversion/references/Loon.md:21` 明确 Loon `$environment.params` 在某些入口可含动态检测上下文，不能凭名称相似映射到 `ctx.env`。
- `egern-skills/skills/egern-native-conversion/references/Stash.md:17` 明确不能把配置策略名当作动态当前节点信息。
- `egern-skills/skills/egern-verification/references/排障与回归.md:21` 把“`ctx.env` 同名即认为等价”列为明确禁止的误判。
- `egern-skills/docs/接手验收.md:25` 要求节点检测 params 必须证明来源运行参数与原生上下文；`egern-skills/docs/当前状态.md:25` 记录该能力尚未证明。
- `egern-skills/docs/官方资料.md:7` 只登记 Egern JavaScript API 的外部地址；工作区没有该官方页面的正文或类型镜像。

候选映射的否定结论：

| 候选 | 拒绝原因 |
| --- | --- |
| `ctx.env` | 用户配置的字符串键值，不是动态节点或规则上下文 |
| `ctx.device` | 本地网络环境，与代理节点名、协议、地址、端口和 TLS 信息无关 |
| `ctx.network` | 本地网络接口信息，不是当前策略或规则上下文 |
| `ctx.lookupIP` | IP 查询能力，不是节点检测参数 |
| 请求选项 `policy` | 出口选择参数；写入策略名不能反证当前节点信息可读 |

第三方原生脚本中的防御式探测不构成 API 证明。`egern-upstream/raw/CaoXiaoMann/XiaoMan/main/Egern/Scripts/Network-Pro/Network-Pro.js:2999-3046` 同时尝试 `node`、`currentProxy`、`selectedProxy`、`selectedNode`、`outbound`、`profile.currentNode` 等互斥形状，并在缺失时返回空值；这只能说明作者不知道稳定字段契约，不能作为字段存在的出处。

Loon 侧来源同样只证明原平台语义，不证明 Egern 等价能力。`egern-upstream/raw/getsomecat/Loon/main/Net_Speedlite.js:34`、`:43`、`:64` 读取 `$environment.params.node` 与 `.nodeInfo.name`；`egern-upstream/raw/MCdasheng/Loon/main/Streaming/ChatGPT.js:36`、`:93`、`:137` 读取 `$environment.params.node`。这些文件证明的是待转换输入，不是目标平台 API。

## 审计范围

| 资料库 | 本地事实 | 与动态节点上下文相关的结果 |
| --- | --- | --- |
| `egern-upstream` | `README.md:1-3` 说明只保存上游原始字节和抓取快照；本地有 486 个 Markdown、907 个 JavaScript 文件 | 未发现官方 JavaScript API 正文或类型定义；29 个原生 Egern 入口没有直接读取节点/策略上下文字段 |
| `egern-core` | `README.md:1-3` 说明这是抓取、同步与网站构建程序；`docs/deployment.md` 只描述部署与构建 | 未发现 `ctx` API 定义，也没有 `$environment.params` 或动态节点字段映射 |
| `egern-skills` | 30 个 Markdown，包含原生转换和验证 references | 明确记录 `$environment.params` 不可等同于 `ctx.env`，并要求证明真实运行上下文 |
| `egern-site` | 只有 `README.md:1`，说明存放构建后的静态网站 | 没有源码、API 文档或类型定义 |

四个资料库中 `.ts`、`.d.ts`、`.d.mts`、`.d.cts` 和 `*types*`/`*typings*` 文件数量均为 0。`egern-skills/docs/官方资料.md:7` 只登记 Egern JavaScript API 的外部地址，并说明链接内容需要按实际版本核对；工作区没有该页面正文镜像。

## 原生 `ctx` 证据

按 `export default async function (ctx...)` 识别出 29 个原生 Egern 入口。其直接成员访问统计为：

| 字段 | 次数 | 可证明的用途 |
| --- | ---: | --- |
| `ctx.http` | 88 | 主动 HTTP |
| `ctx.env` | 46 | 用户配置的字符串键值 |
| `ctx.storage` | 24 | 持久化 |
| `ctx.widgetFamily` | 18 | generic 小组件尺寸 |
| `ctx.device` | 4 | 本地网络环境 |
| `ctx.request` / `ctx.respond` / `ctx.network` | 各 1 | 当前请求、直接回复、网络接口信息 |

直接访问中没有 `ctx.node`、`ctx.nodes`、`ctx.policy`、`ctx.policies`、`ctx.proxy`、`ctx.proxies`、`ctx.rule`、`ctx.rules`、`ctx.context`、`ctx.runtime`、`ctx.params` 或 `ctx.environment`。

这些字段的语义边界如下：

- `egern-skills/skills/egern-native-conversion/references/原生API.md:15` 把 `ctx.env` 定义为参数配置；同文件 `:26` 明确 `ctx.env` 是字符串键值配置，不能冒充动态节点参数。
- `egern-upstream/raw/mickeu/Egern/main/数据中心.js:31` 从 `ctx.env.POLICY` 读取用户填写的策略名，并在 `:38` 把它写入请求选项；`egern-upstream/raw/Bf0rest/Egern/main/Widget/IPPure-emoji.js:209` 的 `ctx.env.GROUP` 也是配置项。请求 `policy` 是出口选择参数，不是当前节点信息。
- `egern-upstream/raw/jadkg/egern/main/NetworkInfo.js:4-8` 仅使用 `ctx.device` 的 `wifi`、`cellular`、`ipv4`、`ipv6`；`egern-upstream/raw/lylywayr/NetWork-Module/main/Egern/网络诊断雷达/网络诊断雷达.js:118-125` 还读取 `dnsServers`。这些是本地网络接口数据，不是代理节点或规则上下文。
- `egern-upstream/raw/xcgtb/Egern-Widgets/main/Network-Pro.js:80-86` 组合 `ctx.device` 与 `ctx.network`，读取 IPv4 地址和网关等接口信息，同样没有节点名、节点类型或当前策略。

### 防御式探测不是 API 证明

`egern-upstream/raw/lylywayr/NetWork-Module/main/Egern/网络诊断雷达/网络诊断雷达.js:2999-3048` 会依次尝试 `node`、`proxy`、`currentProxy`、`selectedProxy`、`selectedNode`、`policy.node`、`policy.selected`、`policy.current`、`outbound`、`profile.currentNode`、`profile.selectedNode` 等互斥形状；`:3061-3144` 还会递归扫描任意对象中的 `proxy`/`node`/`policy` 名称。`getAt` 的实现位于 `:4714-4732`，缺失路径返回空字符串。

这种多点猜测恰恰说明上游作者没有确定字段契约。它是第三方原生脚本的兼容性探测，没有官方文档、类型定义或运行测试作为依据，不能反过来证明这些路径存在。审计继续把它们视为未知，不据此生成映射。

## `$environment.params` 来源用法

上游快照中共有 9 个 JavaScript 文件读取 `$environment.params`：

| 来源 | 读取字段 | 当前三格式诊断状态 |
| --- | --- | --- |
| `MCdasheng/Loon/main/Streaming/ChatGPT.js` | `.node`，行 36、93、137 | 是 |
| `Loon0x00/LoonScript/main/MediaCheck/check.js` | `.node`，行 25-26 后传入请求 | 是 |
| `getsomecat/Loon/main/Net_Speedlite.js` | `.node` 行 34、43；`.nodeInfo.name` 行 64 | 是 |
| `Loon0x00/LoonExampleConfig/master/Script/generic_example.js` | `.node` 行 24-25、59；注释描述 `nodeInfo` 行 13-22 | 是 |
| `fmz200/wool_scripts/main/Scripts/tools/LocationDetection.js` | `.node` 行 23-24、58；注释描述 `nodeInfo` 行 13-22 | 是 |
| `fmz200/wool_scripts/main/Scripts/tools/NodeUnlockDetection.js` | `.node` 行 22-23 后传入请求 | 是 |
| `MCdasheng/Loon/main/Streaming/Spotify.js` | `.node` 行 46、67、100、137、168 | 未进入当前 E2E 阻断集 |
| `Keywos/rule/master/script/netisp/js/loon.js` | `.node`、`.nodeInfo.address`，行 15 | 未进入当前 E2E 阻断集 |
| `Sliverkiss/QuantumultX/main/Script/proxyChain.js` | 整个 `$environment.params` 作为请求策略，行 40 | 未进入当前 E2E 阻断集 |

前六个来源在三格式诊断中合计 18 个失败组合。若把 `$environment.params` 猜成 `ctx.env` 或请求 `policy`，只能让脚本越过名称检查，无法证明节点名称、节点地址、端口、TLS 或类型数据真实存在；继续推进也会落入 HTTP 对象和完成流证明层。本轮审计没有产生任何 E2E 成功增量。

## 拒绝与重开条件

保持拒绝时必须满足以下边界：

- `$environment.params.node` 与 `$environment.params.nodeInfo.*` 均保持未知。
- 不把 `ctx.env` 的配置值、`ctx.device` 的本地网络字段、`ctx.network` 的接口字段或请求 `policy` 名称当作动态节点上下文。
- 不按脚本名、作者、URL、文件摘要选择例外。
- 回归样例同时覆盖整体参数对象与嵌套 `nodeInfo`，确保它们继续被拒绝。

重新开启研究的条件：

1. 取得对应版本的 Egern 官方 JavaScript API 字段定义，或官方类型定义。
2. 明确节点名、节点地址、端口、TLS、协议类型、当前策略或规则上下文中实际可读的字段及入口阶段。
3. 用通用数据流规则实现映射，并补“已证明字段可转换 / 缺失或未知字段仍拒绝”的双向回归。
4. 以 E2E 成功数上升作为有效增益；仅改变首阻塞不计入。
