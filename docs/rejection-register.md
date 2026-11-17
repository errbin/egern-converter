# 既定拒绝清单

## 口径与状态

- 核验起点：`main` = `92d8cf7`（2026-11-16）；普查快照为 **285/327 组合、
  95/109 URL**。
- 剩余失败：**42 个组合 = 14 个 URL × qx/surge/loon 三格式**。
- “既定拒绝”表示在当前可审计证据下不生成转换产物，不表示已经证明 Egern
  永远不存在对应能力；“权威依据下的永久拒绝”表示官方完整契约已经证明目标宿主
  不存在对应入口，在官方 API 扩展前不再重复审计。
- 本清单不改变任何转换行为，不新增脚本特例，不放宽 fixture、验证预算或宿主
  能力边界。
- 继续执行三条强制规则：产物不得依赖未经真机验证的宿主方法；fixture 必须与
  真机一致，禁止为让脚本通过而增加真机没有的能力；两边同错不等于等价。

## 汇总

| # | 脚本 | 类别 | 当前首阻塞 | 缺失能力或证明 | 重开条件 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `generic_example` | `$environment.params`（永久拒绝） | 未适配 API 成员：`$environment.params` | 官方 `ctx` 无节点/策略读取字段 | 官方 API 新增等价字段 |
| 2 | `check` | `$environment.params`（永久拒绝） | 未适配 API 成员：`$environment.params` | 官方 `ctx` 无节点/策略读取字段 | 官方 API 新增等价字段 |
| 3 | `ChatGPT` | `$environment.params`（永久拒绝） | 未适配 API 成员：`$environment.params` | 官方 `ctx` 无节点/策略读取字段 | 官方 API 新增等价字段 |
| 4 | `LocationDetection` | `$environment.params`（永久拒绝） | 未适配 API 成员：`$environment.params` | 官方 `ctx` 无节点/策略读取字段 | 官方 API 新增等价字段 |
| 5 | `NodeUnlockDetection` | `$environment.params`（永久拒绝） | 未适配 API 成员：`$environment.params` | 官方 `ctx` 无节点/策略读取字段 | 官方 API 新增等价字段 |
| 6 | `Net_Speedlite` | `$environment.params`（永久拒绝） | 未适配 API 成员：`$environment.params` | 官方 `ctx` 无节点/策略读取字段；surge 另有面板输入/版本字段 | 官方 API 新增等价字段 |
| 7 | `NoAds` | 宿主能力缺失 | 缺失全局探测结果传入未知代码：`window` | 探测前整表逃逸不改写被探测字段；globalThis/crypto 契约 | 逃逸效果证明 + 官方宿主契约 |
| 8 | `ximalaya` | 宿主能力缺失 | 运行环境依赖：`global/process/require/setInterval/window` | Node 分支不可达或宿主契约；周期回调终止性 | 官方宿主/定时器契约 |
| 9 | `NeteaseMusicVipCrack` | 宿主能力缺失 | 缺失全局探测结果传入未知代码：`process` | 探测结果只进入可折叠观察点；周期自防御回调不可达/无副作用 | 官方宿主/定时器契约 |
| 10 | `TilingSales_getNav` | 宿主能力缺失 | 运行环境依赖：`global/globalThis/require/setTimeout` | crypto provider 与模块加载契约；browserify/crypto-js 异步路径不可达 | 官方 crypto/require 契约 |
| 11 | `alidns` | DNS 脚本（永久拒绝） | `$domain` 无宿主入口 | 官方仅五种脚本类型，没有 DNS 类型 | 官方新增 DNS 脚本类型 |
| 12 | `bbaabbyy` | 特殊 | `Unexpected token (103:0)` | 源文件语法完整 | 上游修复源码 |
| 13 | `one` | 特殊 | 没有可识别的 `$done` 完成入口 | 静态可见的完成契约；远程 `eval` 的 Env/Utils 不可证明 | 上游移除动态依赖或提供可审查契约 |
| 14 | `haijiao` | 特殊 | `$notification` 整体传递/动态属性；qx 为 `$notify` 值传递 | 平台对象只作身份判断的证明；动态成员键静态解析 | 通用动态键与封闭 helper 契约 |

## 一、`$environment.params` 族（6 个，权威依据下永久拒绝）

### 共同缺的能力

Egern 官方 JavaScript API 的完整 `ctx` 字段清单没有“动态节点、当前策略、代理或
规则运行上下文参数”。`ctx.env` 是用户配置的字符串键值，不是 Loon 某些入口中的
动态检测上下文；`ctx.device` 是本地网络环境，不是节点名、节点地址、端口、TLS
或协议类型。因此不能把 `$environment.params` 或 `.node` / `.nodeInfo.*` 猜成
任何现有 `ctx` 字段，也不能把节点名当作请求 `policy` 使用。

### 共同已尝试

- 2026-11-16 取得 Egern 官方 JavaScript API 正文；完整字段清单和五种脚本类型
  均不含节点、策略、代理、规则上下文或 DNS 脚本入口。
- 已审查 `ctx.env`、`ctx.device`、`ctx.network`、`ctx.lookupIP` 和请求
  `policy` 五个候选，均被否定。
- 没有做“只改名称让脚本越过检查”的临时映射，也没有把用户手填 `NODE` 参数冒充
  当前节点探测结果。

### 共同权威依据

- `docs/environment-params-availability.md`：2026-11-16 官方字段清单、五种
  脚本类型、候选映射否定和永久拒绝裁定。
- `egern-skills/skills/egern-native-conversion/references/官方JavaScriptAPI.md`：
  官方正文节选（抓取日期、链接、`ctx` 字段表）。
- `egern-skills/skills/egern-native-conversion/references/原生API.md:15,26`：
  `ctx.env` 是字符串键值配置，不能冒充动态节点参数。
- `egern-skills/skills/egern-native-conversion/references/Loon.md:21`：
  `$environment.params` 在某些 Loon 入口中是动态检测上下文，不能按名称相似
  映射到 `ctx.env`。

### 1. `generic_example`

- 来源：`Loon0x00/LoonExampleConfig/master/Script/generic_example.js`。
- 读取点：第 10 行 `console.log($environment.params)`；第 24 行
  `var inputParams = $environment.params`；第 59 行 `.node`。
- 首阻塞：三格式均为 `未适配 API 成员：$environment.params`。
- 已尝试：只做了来源审计和候选字段否定；没有转换产物。
- 重开路线：不因“再查一次”重开；只有官方 API 新增当前节点读取字段后，才按通用
  数据流映射，并补“已证明字段可转换 / 缺失或未知字段仍拒绝”的双向回归。

### 2. `check`

- 来源：`Loon0x00/LoonScript/main/MediaCheck/check.js`。
- 读取点：第 25 行整体读取；第 26 行 `inputParams.node`；该值随后进入 HTTP
  请求参数。
- 首阻塞：三格式均为 `未适配 API 成员：$environment.params`。
- 已尝试：同族审计；没有把节点名猜成请求 `policy`。
- 重开路线：同上，仅以官方新增等价字段为前提；届时还须证明该动态值只作为受支持
  的请求选项或展示字段，不改变请求语义。

### 3. `ChatGPT`

- 来源：`MCdasheng/Loon/main/Streaming/ChatGPT.js`。
- 读取点：第 36、93、137 行读取 `.node`。
- 首阻塞：三格式均为 `未适配 API 成员：$environment.params`。
- 已尝试：同族审计；没有映射到 `ctx.env` 或 `ctx.device`。
- 重开路线：同上，仅以官方新增等价字段为前提；届时还需证明该值只用于展示或已审查
  的请求字段。

### 4. `LocationDetection`

- 来源：`fmz200/wool_scripts/main/Scripts/tools/LocationDetection.js`。
- 读取点：第 23 行整体读取；第 58 行 `.node`。
- 首阻塞：三格式均为 `未适配 API 成员：$environment.params`。
- 已尝试：同族审计；没有转换产物。
- 重开路线：同上，仅以官方新增等价字段为前提。

### 5. `NodeUnlockDetection`

- 来源：`fmz200/wool_scripts/main/Scripts/tools/NodeUnlockDetection.js`。
- 读取点：第 22 行整体读取；第 23 行 `.node`；随后进入请求参数。
- 首阻塞：三格式均为 `未适配 API 成员：$environment.params`。
- 已尝试：同族审计；没有转换产物。
- 重开路线：同上，仅以官方新增等价字段为前提；届时还须证明节点值只进入已支持的
  请求路径。

### 6. `Net_Speedlite`

- 来源：`getsomecat/Loon/main/Net_Speedlite.js`。
- 读取点：第 34、43 行 `.node`；第 64 行 `.nodeInfo.name`。
- 首阻塞：qx/loon 为 `$environment.params`；surge 同时报
  `$environment.params`、`$environment.surge-version` 和 `$input`。
- 次级阻塞：第 16 行 `typeof $input != 'undefined'` 与
  `$.lodash_get($input, 'purpose') === 'panel'`；Env 的 `getEnv()` 还读取
  `$environment["surge-version"]`。即使 `$environment.params` 获得契约，
  surge 仍需面板输入和版本字段的权威契约。
- 已尝试：同族审计；没有把 `$input` 面板上下文猜成 `ctx.env`。
- 重开路线：不因节点字段重复审计；只有官方新增动态节点读取字段后，才继续分别核对
  面板输入和版本字段契约，否则只解决首个错误不能形成有效增益。

## 二、宿主能力缺失（4 个）

### 7. `NoAds`

- 来源：`Yuheng0101/X/main/Scripts/ChinaMobile/NoAds.js`，普查快照
  `1b374aabcab2d747.js` 第 35 行。
- 当前首阻塞：三格式均为
  `Node/浏览器全局缺失探测结果传入了未知代码，无法证明可折叠：window`。
- 具体形态：探测位于第 35 行第 232615 列附近的
  `q["GXRsb"]("undefined", typeof window)`。`q` 是第 169711 列附近的封闭
  字面量表，含 868 个属性、1495 个引用；其中 11 个引用不是普通成员读取。
- 探测前关键逃逸：第 35 行第 227008 列附近存在
  `aC["createDecryptor"](Z,q)`，把整张 `q` 表作为实参传给未知/未闭合调用。
  其余 10 个非成员引用包括 6 个后段实参逃逸、一处整表改绑（第 357063 列附近）、
  两个二元表达式和一处一元表达式。
- 缺的证明：无法证明上述探测前调用不会改写 `q["GXRsb"]`，因此不能确定
  探测时读到的是字面量表里的原函数。`bc84afc` 的“同步探测后不可达整表改绑”
  证明只覆盖了探测之后的整表改绑，不覆盖探测前的整表逃逸。
- 已尝试：第 22、44、47 轮均做过逐引用分类；`bc84afc` 新增了后续改绑不可达
  判据；本轮复查确认 `typeof window` 仍在 `probeResultSafeAt` 处被拒。
- 重开路线：为“整表实参逃逸到封闭/可解析调用”建立通用的无写入效果契约，
  证明调用不会写入被探测字段；如果调用不可解析，只能保持拒绝。即使补上该
  证明，后续仍需 Egern `globalThis`/crypto provider 的官方契约和动态请求/
  响应字段闭合证明。
- 权威依据：`docs/remaining-work-round47.md:86-101`；
  `docs/runtime-host-dependency-audit.md:181-219`；
  `docs/conversion-boundaries.md:91-93`。

### 8. `ximalaya`

- 来源：`WeiGiegie/666/main/ximalaya.js`，普查快照
  `31496bc9b19b959e.js` 第 39-40 行。
- 当前首阻塞：三格式均为 `global`、`process`、`require`、`setInterval`、
  `window`。
- 缺的能力一：Node/CommonJS 分支的静态不可达证明，或经真机验证的
  `require`/`process`/`global`/`window` 契约。这里的 `require("fs")`、
  `require("path")`、`process.cwd()` 位于 Env 的 Node 分支，结果参与业务，
  不能按“缺失全局探测”直接折叠。
- 缺的能力二：`setInterval` 周期回调的语义证明。回调 `_0xd9cb26` 同时被显式
  调用和周期调用，函数体约 16k 字符，包含大量可观察操作；源码没有
  `clearInterval`，也没有证明回调无业务副作用、必定终止或可安全丢弃。
- 已尝试：第 44 轮对 26 个自由引用做过分类；`getEnv()` 已能折叠到 Surge，
  但剩余 Env 副本的 `this.isNode()` 未化简，11 个 Node 分支引用仍被判活。
  没有新增脚本级产物。
- 重开路线：先做封闭 Env 实例方法折叠/类剪枝，证明 Node 分支不可达；同时
  取得定时器的真机契约，或证明回调无副作用且可终止。不能把周期调用一对一
  改成一次 `setTimeout` 来绕过。
- 权威依据：`docs/runtime-host-dependency-audit.md:204-219,312-315`；
  `docs/remaining-work-round47.md:102-120`；
  `egern-skills/skills/egern-native-conversion/references/原生API.md:5,15,26`。

### 9. `NeteaseMusicVipCrack`

- 来源：`yqc007/QuantumultX/master/NeteaseMusicVipCrack.js`，普查快照
  `9b4c0305da1ee57c.js` 第 21 行。
- 当前首阻塞：三格式均为
  `Node/浏览器全局缺失探测结果传入了未知代码，无法证明可折叠：process`。
- 缺的证明一：`process` 探测结果只进入可折叠观察点。当前它进入未知代码，
  不能仅按“目标宿主没有 process”折叠。
- 缺的证明二：`setInterval(_0x4d41bf, ...)` 的周期回调可达性/终止性。同一
  位置还直接调用 `_0x4d41bf()`；函数体包含 `debugger`、递归自调用和对象重排，
  属于可达的自防御代码。删除周期调用会改变原脚本的可观察执行序列。
- 已尝试：第 44 轮对 13 个自由引用做过分类；没有证明回调不可达、无副作用或
  必定终止，也没有新增转换产物。
- 重开路线：证明 `process` 探测只进入条件/比较等可折叠位置，并取得定时器
  契约或证明自防御回调与完成/业务状态无关；否则保持拒绝。
- 权威依据：`docs/runtime-host-dependency-audit.md:204-219,312`；
  `docs/remaining-work-round47.md:122-134`；
  `egern-skills/skills/egern-native-conversion/references/原生API.md:5`。

### 10. `TilingSales_getNav`

- 来源：`ZenmoFeiShi/Qx/main/TilingSales_getNav.js`，普查快照
  `11ce1bffbff1078e.js` 第 3-4 行。
- 当前首阻塞：三格式均为 `global`、`globalThis`、`require`、`setTimeout`。
- 缺的能力一：Egern crypto provider 和模块加载的权威契约。第 4 行的
  `globalThis.crypto`、`global.crypto`、`require("crypto")` 位于 JSEncrypt
  的 crypto provider 回退链；第 31 行还读取 `window.JSEncrypt || JSEncrypt`。
- 缺的能力二：browserify 的 `process.nextTick` timer shim 与 crypto-js 异步
  大数路径不可达或被真机契约替代。第 3-4 行的 `setTimeout` 不是单个可删除的
  业务调用，而是两条库路径的一部分。
- 已尝试：第 44 轮对 29 个自由引用做过分类；5 处直接探测已折叠，但
  `require("crypto")` 和 `setTimeout` 仍保留；没有新增转换产物。
- 重开路线：取得官方 crypto provider/模块加载契约和 timer 契约，或证明当前
  业务分支不会进入这些异步路径。不能把异步取数改成同步来伪造等价。
- 权威依据：`docs/runtime-host-dependency-audit.md:217-219,313`；
  `docs/remaining-work-round47.md:136-148`；
  `egern-skills/skills/egern-native-conversion/references/原生API.md:5`。

## 三、DNS 与特殊脚本（4 个）

### 11. `alidns`

- 来源：`Maasea/sgmodule/master/Script/Tools/alidns.js`，普查快照
  `a91ef1e20ca78e68.js`。
- 读取点：第 11 行 `const DOMAIN = $domain`；第 24 行
  `$done({ addresses, ttl: 600 })`。
- 缺的能力：Egern 官方只支持 Request、Response、Schedule、Generic、Network
  五种脚本类型，没有 DNS 脚本类型或 `$domain` 的宿主入口。`ctx.device.dnsServers`
  只是本机 DNS 服务器列表，不是域名到 `addresses` / `ttl` 的查询接口。
- 已尝试：2026-11-16 已核对官方 JavaScript API 正文；没有映射到 `ctx.domain`、
  `ctx.env.domain` 等猜测字段，没有使用 `_compat`，也没有用固定 DoH 上游替代
  动态签名请求。
- 重开路线：权威依据下永久拒绝，从待办移除；只有官方新增 DNS 脚本类型并定义域名
  输入及 `addresses` / `ttl` 返回契约时才重新评估。届时阿里 JSON DoH 的域名和
  时间签名仍须保留原逻辑。
- 权威依据：`docs/environment-params-availability.md`；
  `egern-skills/skills/egern-native-conversion/references/官方JavaScriptAPI.md`；
  `docs/conversion-boundaries.md:52`。

### 12. `bbaabbyy`

- 来源：`ios151/Rewrite/main/itunes/bbaabbyy.js`，普查快照
  `04414f9e445fa6d9.js`。
- 解析事实：第 22 行打开 `else {`；第 24 行开始构造 `objc`；第 99 行只关闭
  对象字面量；第 102 行调用 `$done` 后文件结束。第 22 行的代码块没有闭合，
  `node --check` 在 `103:0` 报 `Unexpected end of input`。
- 缺的能力：语法完整的源文件。当前不能确定作者原本想在何处闭合分支，也不能
  用转换器猜测补括号；修补后的脚本不是原字节，不能伪装成等价产物。
- 已尝试：只做了解析和括号栈核对；没有修改源文件，也没有加解析容错特例。
- 重开路线：等待上游发布修复后的源码；修复前不重新评估。
- 权威依据：`docs/remaining-work-roi.md:240`；源文件第 22、99、102 行；
  `node --check` 的 EOF 错误。

### 13. `one`

- 来源：`ios151/Rewrite/main/one.js`，普查快照
  `31e71aae7b891a57.js` 第 12 行。
- 当前首阻塞：三格式均为 `没有可识别的 $done 完成入口`。
- 具体形态：脚本确实读取 `$response`、改写响应并调用 `$["done"]`，但
  `$` 是 `new Env("one", ...)`；`Env` 的完成方法来自 `loadUtils()` 动态下载
  的 `Utils.js`，随后通过 `eval` 执行。完成契约不在当前脚本的可静态解析正文
  中，不能证明 `$["done"]` 最终如何完成、以什么形状完成。
- 证据位置：源文件第 12 行的 `loadUtils`；缓存命中时 `eval(l11liill)`；
  缓存未命中时从 `cdn.jsdelivr.net` 下载并 `eval(iI1Iii1)`；`$response` /
  `$request` 的读取和改写也在同一行。
- 已尝试：第 43 轮已反混淆并追踪 `one.pretty.js` / `one.decoded.js`，确认
  脚本不是“不产生响应改写”，而是完成契约来自动态 `eval`；因此正式归档，
  不再重复尝试。
- 重开路线：上游改为静态可见的 Env/Utils，或提供与远程内容绑定的可审查契约；
  转换器不能执行下载的代码，也不能把“保留 eval”当作完成转换。
- 权威依据：`docs/conversion-boundaries.md:91-93`（`eval` 保留，但动态文本
  /函数源码自检不构成全输入等价证明）；`docs/remaining-work-roi.md:238`；
  `egern-skills/skills/egern-native-conversion/references/JavaScript与第三方库.md:17,19`。

### 14. `haijiao`

- 来源：`ios151/Rewrite/main/haijiao.js`，普查快照
  `b3c99155064e1881.js` 第 14 行。
- 当前首阻塞：qx 为 `$notify` 作为值传递；surge/loon 为 `$notification`
  整体传递；三格式还包含动态属性和 `window`。
- 具体形态：第 14 行第 160174 列附近
  `_0x22645a($notification) && $notification[计算键](...)`；第 338011 列
  附近再次整体传递；第 338336 列附近把 `$notify` 整体传给 helper；第
  334314 列附近读取 `$task[计算键]`；第 170270 列附近存在 `window` 回退。
- 缺的证明一：平台对象只用于身份/存在性判断，helper 不会把它当作业务值保存
  或改写。
- 缺的证明二：`$notification[计算键]` 和 `$task[计算键]` 的计算键必须静态
  解析为已审查的方法名；当前是混淆表达式，不能按名称猜 `post`。
- 缺的证明三：`window` 分支不可达或由真机契约替代。
- 已尝试：既有 ROI 审计曾临时绕过平台对象和动态属性，随后仍推进到
  `window` 和其他动态成员，无法形成单层通用放行；本轮没有重复硬绕。
- 重开路线：实现混淆成员键的受限静态求值，并为通知/任务对象建立封闭 helper
  契约；再证明 `window` 分支不可达。不能按脚本名或单个属性名加白名单。
- 权威依据：`docs/script-api-compatibility.md:42,52,66,70`（只直接映射
  `$notification.post` / `$notify` 的调用，不把平台对象当值）；
  `docs/conversion-boundaries.md:54,83`（动态字段、别名逃逸和方法覆写不能
  放行）；`docs/remaining-work-roi.md:130,143-144`。

## v2fly/domain-list-community 的 regexp 裁定（已撤销错误归一化）

- 来源：`v2fly/domain-list-community` 的 1557 个离线 `data/` 文件，2026-11-18 快照。
- 撤销的旧裁定：曾假设 Egern `domain_regex` 是整串匹配，因而对 `(^|\.)...$` 追加 `.*`、对其他 `$` 结尾模式前置 `.*`，并拒绝无法证明双语义等价的未锚定模式。该假设已被官方文档否定。
- 权威依据：Egern 官方 DNS 文档明确 `domain_regex` 为 PCRE2 **find / 搜索语义**——任意子串命中即匹配；v2fly 的 `regexp:` 使用 Go `regexp.Compile` 校验、`MatchString` 匹配，同为搜索语义。两侧语义相同，不需要也不允许归一化。
- 当前裁定：`regexp:` 的值原样写入 `domain_regex_set`。删除 `_normalized_regexp`、`normalize_regexp` 以及 anchored / prefix_wide / dot_boundary / other_dollar 分类；除 Python 语法校验失败外，不拒绝任何 regexp。
- 恢复收录：`data/okaapps` 第 4 行的 `^(.+\.)*zh\.okaapps\.com$` 不再被当作等价性超时项或拒绝项，已随原串收录。该模式的嵌套重复在回溯引擎上有性能风险，应在运行期做超时或长度保护，但不能据此改写或拒绝。
- 实测：163 条 regexp 出现 163/163 收录，拒绝 0 条；Python 与 Go 编译结论不一致 0 条；转换输出对 56,066 个语料域名按 `re.search` 与原串逐条比对，mismatch 为 0。详细报告见 `.local/dlc-regex-report2.json`。
- 重开条件：只有官方给出与 find 语义不同的 `domain_regex` 契约，才重新评估；不得恢复基于整串假设的前缀改写或未锚定拒绝。

## 重开与验收协议

1. 先补通用静态证明或取得官方/真机契约，再修改转换器；不得先按脚本名放行。
2. 新增能力必须同时覆盖正例和反例，反例至少包含未证明字段、动态键、整体逃逸
   和未验证宿主方法。
3. 以 327 组合普查的成功数上升为有效增益；只改变首阻塞错误文本不计入。
4. 全量套件失败集合必须与当前基线 `diff=0`，且不得调大 `verify.py` 预算。
5. 任何 fixture 变更都必须有真机依据，不能为了让脚本通过而扩大宿主能力。

## 当前核验记录

- 普查：`285/327` 组合、`95/109` URL；剩余 `42` 个失败组合即本清单 14 个 URL。
- 全量套件：`894` tests、`38` failures、`67` skipped；失败集合与
  `92d8cf7` 基线逐条 `diff=0`。新增测试只覆盖压缩 API 正反例，没有放行旧失败。
- 本文件中的结案与拒收口径是文档变更；`ctx.compress` 的六成员能力在独立单元
  提交，不改变两条永久拒绝的判定。
