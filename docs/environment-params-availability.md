# Loon `$environment.params` 原生可用性裁定

裁定日期：2026-11-16（Asia/Shanghai）。依据：Egern 官方 JavaScript API 正文，
英文 <https://egernapp.com/docs/javascript-api/>，中文
<https://egernapp.com/zh-CN/docs/javascript-api/>。正文已抓取并节选到
`egern-skills/skills/egern-native-conversion/references/官方JavaScriptAPI.md`。

## 正式结论

**官方文档证明 Egern 原生 `ctx` 不存在读取当前节点、当前策略、代理或规则运行
上下文的字段。** Loon `$environment.params.node`、`.nodeInfo.*` 因此在 Egern
上没有等价能力，继续按“未适配 API 成员：`$environment.params`”拒绝，并标记为
权威依据下的永久拒绝。

这不是“工作区没找到资料”的暂时缺证，也不是“尚未发现”的待办。此前九轮审计在
没有官网页正文时只能得出“可审计工作区中不存在”；本轮取得一手正文后，结论升级
为“官方完整字段清单中不存在”。在官方 API 新增等价字段前，不再重复审计同一问题。

## 官方字段清单

官方文档列出的脚本类型只有五种：Request、Response、Schedule、Generic、Network。
其中没有 DNS 脚本类型。`ctx` 的完整字段和用途如下：

| 官方字段 | 语义 |
| --- | --- |
| `ctx.script.name` | 当前脚本名 |
| `ctx.env` | 用户配置的 `Object<string,string>` 环境变量键值 |
| `ctx.app.version` / `ctx.app.language` | Egern 版本与语言 |
| `ctx.device.cellular.*` / `.wifi.*` / `.ipv4.*` / `.ipv6.*` / `.dnsServers` | 本机网络与 DNS 服务器配置 |
| `ctx.cron` | 仅 Schedule 脚本 |
| `ctx.widgetFamily` | 仅 Generic 脚本 |
| `ctx.request` | 仅 Request / Response 脚本；方法、URL、Headers、正文读取等 |
| `ctx.response` | 仅 Response 脚本；状态、Headers、正文读取等 |
| `ctx.http` | `get` / `post` / `put` / `delete` / `head` / `options` / `patch` |
| `ctx.storage` | `get` / `set` / `getJSON` / `setJSON` / `delete` |
| `ctx.notify(options)` | 原生通知 |
| `ctx.lookupIP(ip)` | 返回 `{country, asn, organization}` |
| `ctx.compress` | `gzip` / `gunzip` / `deflate` / `inflate` / `brotli` / `unbrotli` |
| `ctx.ssh` | SSH / SFTP 客户端 |
| `ctx.respond(response)` | 直接响应 |
| `ctx.abort()` | 中止脚本 |

清单中没有 `node` / `nodes` / `policy` 读取 / `proxy` / `rule` / `context` /
`runtime` / `params` / `environment` 字段，也没有以其他名称暴露当前节点或策略。

`ctx.http` 的选项确实包含 `policy` 与 `policyDescriptor`，但它们是**发送请求时的
出口选择输入**，回答“这次请求走哪条策略”；它们不是宿主返回的当前节点读取结果，
不能反过来证明脚本可以读取正在使用的节点。把节点名写入该选项也不是等价转换。

## 候选映射否定

| 候选 | 拒绝原因 |
| --- | --- |
| `ctx.env` | 用户配置的字符串键值；填入节点名只是替换成用户手填值 |
| `ctx.device` | 本机蜂窝、Wi-Fi、IP 与 DNS 服务器信息，不含代理节点身份 |
| `ctx.lookupIP` | IP 地理位置 / ASN / 组织查询，不是当前目录节点信息 |
| `ctx.http` 的 `policy` / `policyDescriptor` | 请求出口选择输入，不是当前节点读取 |
| `ctx.script` / `ctx.app` / `ctx.cron` | 脚本元信息、应用信息和定时表达式 |

不能把 `$environment.params.node` 映射为模块 `env_schema` 中由用户手填的
`NODE` 参数。那会把“探测当前真实节点”语义反转成“显示用户配置值”，使
ChatGPT、Spotify、check、Net_Speedlite、generic_example、LocationDetection、
NodeUnlockDetection 等检测脚本长期返回错误答案。除极少数只展示名称、不参与判断
的场景外，这种降级产物是错误实现，本项目不生成。

## `$domain` 与 DNS 脚本

官方仅支持 Request、Response、Schedule、Generic、Network 五种脚本类型，**没有
DNS 脚本类型**。`$domain` 在 Egern 上没有宿主入口。`ctx.device.dnsServers` 只是
本机 DNS 服务器列表，不是“查询域名 → 返回 `addresses` / `ttl`”的能力。

因此 `alidns` 一类 DNS 应答脚本无法在 Egern 上等价实现，标记为权威依据下的永久
拒绝，并从待办中移除。不得猜测 `ctx.domain`、`ctx.env.domain`，也不得用固定 DoH
上游替换原脚本的动态域名和时间签名逻辑。

## 维持与重开规则

- 不按脚本名、作者、URL 或字段形状添加特例；上述拒绝是通用 API 边界。
- 产物不得依赖官方清单之外的节点、策略、DNS 或代理上下文方法。
- 只有官方 JavaScript API 明确新增相应字段/脚本类型，或提供可复核的真机契约，
  才重新评估；重新评估必须补通用映射和正反双向回归，不能只让单个脚本越过检查。
- 历史审计记录的价值到此为止：2026-11-10 第九轮及以前的“工作区未找到”结论已被
  本轮官方正文取代，不再作为重复审计的依据。
