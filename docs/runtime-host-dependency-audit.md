# 运行环境与动态宿主依赖审计（第八轮）

## 口径与数据来源

- 基线：`/root/egern/.local/impact/round8-final.json`。
- 总量：327 个 URL × 格式组合，109 个 URL；当前 **122/327** 组合成功，**42/109** URL 至少一个格式成功。
- 失败 URL：67 个；按 `qx`、`surge`、`loon` 顺序取第一条首阻塞，其中 **21 个**首阻塞属于 `运行环境或动态/异步依赖`。
- 本审计只讨论这 21 个；`haijiao` 等首阻塞为 HTTP 参数/平台的 URL 不计入运行环境族。

本轮没有提交放行代码。所有实验都在工作区外或临时改动中完成，随后回退；最终 E2E 与第七轮逐组合一致。

## 21 个 URL 的主形态

下表按“首阻塞 + 源码结构”给出主形态，每行只归一个主形态，合计 21。

| URL 源文件 | 主形态 | 首阻塞 / 关键证据 |
| --- | --- | --- |
| `86665d7cf40b4a84.js` | 定时器作为值传递 | `setTimeout` 传给未解析的 `b["nVGWb"]`，无法证明只调用一次 |
| `1a3251d4900a71af.js` | 多平台成员探测 | `"$task" in globalThis` 等探测；另有 crypto-js 的 `window/self/globalThis.crypto` 与 `require("crypto")` |
| `bc599fd45d7145d9.js` | 封闭 Env + Node 分支 | `getEnv()`/`isNode()`，`require("fs")`、`require("path")`、`process.cwd()` |
| `84be9ca4ac4c8e3d.js` | 多平台成员探测 | `"Egern" in globalThis` 等探测；`globalThis.$argument` 归一化；后续完成结果形状 |
| `a121e6fbbd0a770c.js` | 多平台成员探测 | 同 `insav` 模板；crypto-js 的 `window/self/globalThis.crypto` 与 `require("crypto")` |
| `07da264c8f8eeda1.js` | 浏览器全局回退 | 混淆库里 `_0x572bfe = window` 的 catch 回退 |
| `a274a723dd76f7b5.js` | 多平台成员探测 | 同模板；crypto-js 的 WebCrypto/Node 回退 |
| `d59d28a0de8558fd.js` | 多平台成员探测 | 同模板；crypto-js 的 WebCrypto/Node 回退 |
| `196340e065078c7d.js` | 多平台成员探测 | 同模板；crypto-js 的 WebCrypto/Node 回退 |
| `2545ad685f70738b.js` | 封闭 Env + Node 分支 | `getEnv()`/`isNode()` + `process`/`require`；后续 `$done` 调用者不可解析 |
| `0c5e6347a754f42a.js` | 多平台成员探测 | `"Egern" in globalThis` 等探测；`globalThis.$argument` 归一化；后续 HTTP/通知对象形状 |
| `63846a496abf924d.js` | 多平台成员探测 | 同模板；crypto-js 的 WebCrypto/Node 回退 |
| `7c129fc9129dcfcc.js` | 浏览器/DOM 脚本加载 | `window.CryptoJS`、`document.createElement("script")` |
| `b169b9bd81b670b1.js` | 多平台成员探测 | 同模板；crypto-js 的 WebCrypto/Node 回退 |
| `7062a075192e2edc.js` | 动态代码执行 | `Function(resp.body).call(globalThis)` 与 `globalThis.fzstd` |
| `d80609bc7f5506f2.js` | 构造器式 Env + Node 分支 | `this.isSurge = () => true` 等；Node 支 `require("https")` |
| `2f544c44d499c427.js` | 浏览器全局回退 + 周期定时器 | `typeof window/process/require/global` 回退；`setInterval` |
| `31496bc9b19b959e.js` | 封闭 Env + Node 分支 | `getEnv()`/`isNode()` + `process`/`require`/`setInterval` |
| `11ce1bffbff1078e.js` | 浏览器全局回退 + 库依赖 | crypto-js/JSEncrypt 的 `global/globalThis/require` 与 `setTimeout` |
| `9b4c0305da1ee57c.js` | 浏览器全局回退 + 周期定时器 | crypto-js 的 `window/global` 回退；`setInterval` |
| `e67757fe27d87eca.js` | 浏览器全局回退 | 混淆库里 `_0x38e329 = window` 的 catch 回退 |

主形态计数：

| 主形态 | 数量 | URL 源文件 |
| --- | ---: | --- |
| 多平台成员探测 | 9 | `insav`、`javhd`、`luolita`、`6lpu5`、`huangdou`、`fi11`、`xjh51`、`porntube`、`qiyoushequ` |
| 封闭 Env + Node 分支 | 4 | `insav.tv`、`xfbs`、`wps`、`ximalaya` |
| 浏览器/WebCrypto 回退 | 5 | `cad`、`QDVIP`、`TilingSales`、`Netease`、`zimuquan` |
| 定时器作为值传递 | 1 | `AppraveTask` |
| 动态代码执行 | 1 | `tlsm` |
| 浏览器/DOM 脚本加载 | 1 | `porntube-frontend` |

## 形态重叠计数

同一脚本可能同时命中多个形态，以下计数**不求和**：

| 形态 | 数量 | 说明 |
| --- | ---: | --- |
| 经典 Env/`getEnv`/`isNode` + `require`/`process` | 4 | `insav.tv`、`xfbs`、`wps`、`ximalaya` |
| `window`/`global` 回退赋值 | 13 | 上述 9 个模板脚本中的 8 个，加上 `cad`、`QDVIP`、`TilingSales`、`Netease`、`zimuquan` |
| `setTimeout`/`setInterval` | 8（首阻塞路径）/ 13（源码出现） | 首阻塞路径：`AppraveTask`、`insav.tv`、`tlsm`、`wps`、`QDVIP`、`ximalaya`、`TilingSales`、`Netease`；另外 5 个位于已折叠或非业务 Env 分支 |
| `'name' in globalThis` 平台探测 | 9 | 与“多平台成员探测”主形态一致 |
| 动态 `Function(globalThis)` | 1 | `tlsm` |
| DOM/浏览器探测 | 3 | `porntube-frontend` 是直接执行路径；`javhd` 是注入响应 HTML 的文本；`TilingSales` 是 crypto-js 浏览器回退 |
| generator/regenerator `.wrap` 首阻塞 | 0 | 见 `completion-state-machine-proof.md`；解码后语料中另有 25 个失败 URL 含 `abrupt`、29 个含 `wrap`，但都不是当前首阻塞 |

## 静态可证性判定

### 1. 多平台成员探测（9）

**能证明的部分**：`key in globalThis` 的封闭常量探测、`typeof globalThis` 的标准语义、以及 `$task`/`$loon`/`$rocket`/`$environment` 的目标平台存在性，已有结构化折叠；`platform/globals.mjs` 只接受封闭成员探测，不执行原文。

**不能证明的部分**：这 9 个脚本的后续代码仍依赖以下至少一项：

- crypto-js 的 `window.crypto`、`self.crypto`、`globalThis.crypto`、`require("crypto")`；
- Node/浏览器回退或 `$argument` 全局归一化；
- HTTP/通知参数不是静态对象；
- 完成结果变量被重新赋值。

只放行成员探测不会提高成功数；实测只把首阻塞推进到下一层。因此保持现状，不为单个脚本猜测平台映射。

### 2. 封闭 Env + Node 分支（4）

**能证明的部分**：如果 Env 是封闭工厂/类，平台探测方法只做 `typeof`/平台根对象/字符串比较，且实例没有逃逸，则可以把探测折到目标平台并剪掉不可达 Node 方法。现有 `multiPlatformEnv` 已覆盖“工厂返回 class”的窄形态。

**不能证明的部分**：

- `wps` 在构造器里安装 `this.isSurge = () => true` 等箭头谓词，不是“工厂返回 class”；
- `insav.tv`/`xfbs` 存在 `P = $; O = P["getdata"]; O["call"](P, ...)` 的方法值提取与别名调用，当前实例封闭性判据会拒绝；
- `ximalaya` 还叠加 crypto-js/全局回退与周期定时器；
- 即使手工折叠，四个脚本分别推进到完成回调、`$done` 调用者、HTTP 字段流等独立族，均未达到 E2E 成功。

结论：这是一项可继续研究的通用结构能力，但本轮没有形成能提高成功数的闭合实现，不提交半截放行。

### 3. 浏览器/WebCrypto 回退（5）

**能证明的部分**：`typeof globalThis !== "undefined" ? globalThis : ...` 这类标准回退链可以静态折到 `globalThis`；`typeof window/global/process/require` 在目标原生运行时可按现有代码约定折成 `undefined`。

**不能证明的部分**：

- `globalThis.crypto`、`window.crypto`、`self.crypto`、`window.msCrypto` 是否有宿主等价能力，没有本地权威依据；
- `require("crypto")` 的 Node 行为不可证明；
- JSEncrypt/crypto-js 的 UMD 初始化会立即执行浏览器/Node 探测；
- 把这些映射到 `ctx` 属于平台猜测，必须拒绝。

结论：保持拒绝。只做标准回退链折叠属于阶段推进，不是有效增益。

### 4. 定时器宿主依赖（8 条首阻塞路径）

**能证明的部分**：已支持一次性 `setTimeout(callback, delay)` 的封闭回调及其完成传播；回调必须是可追溯函数，参数个数和启动位置保持原样。

**不能证明的部分**：

- `AppraveTask` 把 `setTimeout` 作为值传给未解析的 `b["nVGWb"]`，无法证明该 helper 只调用一次、调用时机和返回值；
- `setInterval` 的周期语义没有原生一对一映射，且无法证明终止条件；不能把它改成一次性定时器；
- 定时器回调里的完成、异常和并发顺序无法用当前结构化流程证明。

结论：保持拒绝。`setTimeout` 本身不是新阻塞，值传递/周期语义才是。

### 5. 动态代码执行（1）

`tlsm` 的 `Function(resp.body || "").call(globalThis)` 会执行网络响应正文；正文内容、作用域和副作用都无法静态证明。`globalThis.fzstd` 也没有本地权威的宿主能力依据。保持拒绝。

### 6. 浏览器/DOM（3）

`document.createElement("script")`、`window.CryptoJS` 需要 DOM 与动态脚本加载；Egern 原生入口没有 DOM。`javhd` 的 DOM 代码位于注入响应的 HTML 文本中，不是脚本执行路径，但该脚本仍被前两类阻塞挡住。保持拒绝。

## 诊断实验记录

以下实验均为临时诊断，未提交：

| 实验 | 结果 | 有效增益 |
| --- | --- | --- |
| 允许裸 `globalThis` 作为标准内建访问 | `javhd`/`xjh51` 推进到“全局对象访问超出可确认的标准 JavaScript 内建字段”；`tlsm` 推进到 HTTP 字段修改 | 无，42/109 不变 |
| `=window` 改为 `=this`/`=globalThis` | `cad`/`zimuquan` 推进到 HTTP 请求/响应字段层 | 无，42/109 不变 |
| 封闭 `globalThis.$argument` 本地归一化 | `javhd` 推进到“完成结果变量被重新赋值”；`xjh51` 推进到通知/HTTP 对象形状 | 无，42/109 不变 |
| 手工折叠 Env 谓词 | `wps` 推进到 HTTP 请求字段流；`insav.tv` 推进到内联完成函数；`xfbs` 推进到 `$done` 调用者 | 无，42/109 不变 |

这些结果说明：运行环境族不是单独一层；只解开运行环境会暴露独立的 HTTP、通知、完成传播或 crypto 依赖族。按验收口径，均只能标注“阶段推进、非有效增益”。

## 验收记录

| 单元 | 端到端前 | 端到端后 | 首阻塞变化 | 判定 |
| --- | --- | --- | --- | --- |
| 运行环境族形态普查与可证性判定 | 42/109（122/327） | 42/109（122/327） | 21 个 URL 仍为运行环境族首阻塞 | 无有效增益 |
| 封闭 `$argument`/Env 折叠诊断 | 42/109（122/327） | 42/109（122/327） | `javhd`/`xjh51`/`wps`/`insav.tv`/`xfbs` 推进到后续族 | 阶段推进、非有效增益，未提交 |
| regenerator 状态机可行性 | 42/109（122/327） | 42/109（122/327） | 0 个 URL 首阻塞为 generator | 设计文档，无代码 |

全量套件：`483` tests，`38` failures，失败集合与 `/root/egern/.local/test-baseline.log` 的 `diff=0`。

E2E：`round8-final.json` 与 `round7-final.json` 逐组合比较，`327` 个 key 相同，成功组合 `122` 不变，失败 URL 集合 `67` 不变，组合差异 `0`。

## 第十二轮：Node/浏览器双目标打包产物的死分支

### 目标集与基线

本轮只处理 `ios151/Rewrite` 下首阻塞为 Node/浏览器全局的 12 个 URL。基线为
`round11-final3-e2e.json`：**46/109 URL（138/327 组合）**。验收口径仍然是只有
端到端成功数上升才算有效增益。

| 源文件 | URL 名称 | 首发形态 |
| --- | --- | --- |
| `1a3251d4900a71af.js` | `insav-tv/dist/insav.js` | `globalThis` + `require` + `window` |
| `a121e6fbbd0a770c.js` | `luolita/dist/luolita.js` | `globalThis` + `require` + `window` |
| `a274a723dd76f7b5.js` | `Hanxiucao/6lpu5.response.js` | `globalThis` + `require` + `window` |
| `d59d28a0de8558fd.js` | `huangdouduanju/dist/huangdou.js` | `globalThis` + `require` + `window` |
| `196340e065078c7d.js` | `hvvj0/dist/fi11.js` | `globalThis` + `require` + `window` |
| `63846a496abf924d.js` | `porntube/dist/porntube.js` | `globalThis` + `require` + `window` |
| `b169b9bd81b670b1.js` | `qiyoushe/dist/qiyoushequ.js` | `globalThis` + `require` + `window` |
| `bc599fd45d7145d9.js` | `insav.tv.js` | `process` + `require` |
| `2545ad685f70738b.js` | `xfbs.js` | `process` + `require` |
| `07da264c8f8eeda1.js` | `cad.js` | `window` |
| `7c129fc9129dcfcc.js` | `porntube/dist/porntube-frontend.js` | `window` + DOM |
| `e67757fe27d87eca.js` | `zimuquan.js` | `window` |

### 形态普查与归组

对 12 份源码逐文件取 free identifier 的父节点和上下文片段后，出现形态归为
以下六类。计数可重叠，不求和。

| 形态 | 出现方式 | 12 个脚本中的分布 |
| --- | --- | --- |
| `typeof X !== "undefined"` 探测 | `window`、`process`、`require`、`module`、`global`；常用于平台/Node 分支和回退链 | 9 个 `globalThis` 模板脚本 + 2 个 Env 脚本 + 3 个 window 脚本 |
| `X.Y` 静态读取 | `globalThis.process`、`globalThis.window`、`globalThis.require`、`globalThis.fetch`、`globalThis.crypto`、`window.crypto`/`msCrypto` | 9 个模板脚本；`porntube-frontend` |
| `X` 作为值传递 | 裸 `window`、`process`、`require`、`global`；或 `const root = window` | `cad`、`zimuquan`、`porntube-frontend` 及模板脚本的回退链 |
| `require(...)` 调用 | `require("fs")`、`require("path")`、`require("crypto")`、`require("got")`、`require("node-fetch")`、`require("fetch-cookie")` | 9 个模板脚本 + `insav.tv` + `xfbs` |
| `process.env.*` / `process.cwd()` / `process.exit()` | Node Env、Node HTTP 分支、退出路径 | 9 个模板脚本 + `insav.tv` + `xfbs` |
| 条件赋值回退链 / runtime shim | `globalThis.fetch || (globalThis.fetch = require("node-fetch"))`；`this.send.call(this.env, ...)`；webpack/vite 的 `__webpack_require__` 包装 | 模板脚本；`insav.tv`/`xfbs` 的 Env `send/get` |

模板脚本的共性结构是：

- `const has = n => n in globalThis` 加 `switch(true)` 选平台；
- `"undefined" != typeof globalThis ? globalThis : typeof window != "undefined" ? window : ...`；
- `Boolean(globalThis.process?.versions?.node)` 作为 Node 分支；
- crypto-js UMD 的 `window.crypto`/`self.crypto`/`globalThis.crypto` 与 `require("crypto")`；
- Node-only 分支里的 `globalThis.fetch = require(...)`、`process.cwd()`、`process.exit()`。

`insav.tv`/`xfbs` 是封闭 Env：`getEnv()/isNode()`、`require("fs"/"path"/"got")`、
`process.cwd()`、`process.exit()`，以及 `send` 内的 `s = this.get; s.call(this, ...)`。

`cad`/`zimuquan` 的 `window` 出现在混淆器的 catch 回退赋值；`porntube-frontend`
直接读取 `window.CryptoJS` 并用 `document.createElement("script")` 加载脚本。

### 已实现的折叠边界

1. **缺失全局的 `typeof` 探测**：目标 Egern 宿主没有 `window`、`process`、`require`、
   `module`、`global` 时，`typeof X` 可折成 `"undefined"`。探测结果只能流入条件、
   比较、逻辑运算、`Boolean`/`String`/`Number`、已知完成调用，或经单次绑定继续流入
   这些位置；传入未知函数时 `assertSafeMissingGlobalProbes` 直接拒绝。
2. **`globalThis` 缺失静态成员**：只对 `globalThis.process/window/require/module/global`
   的静态读取折叠，且必须处于探测/分支/空值比较/逻辑回退位置。直接作为业务值
   （如 `$done({body: globalThis.process})`）、动态成员 `globalThis[key]`、或
   任何 `globalThis.process = ...` 写入都保持拒绝。
3. **Node 死分支**：`if (typeof process !== "undefined") { require("fs") }` 在目标宿主
   折成不可达分支后，`require` 调用随分支删除；活分支里的 `require(...)` 结果参与
   业务仍然拒绝。
4. **`process.env`**：只有位于已证明不可达的 Node 分支或探测回退右侧时才随分支删除；
   直接读取并影响业务逻辑仍然拒绝。
5. **打包 runtime shim**：不按名称猜测 `require`/`__webpack_require__`。只有当完整
   库正文命中已审查的 AST 契约哈希（CryptoJS、fzstd 等）时，才按原字节保护库正文；
   contract 不命中、正文被改写或只是注释伪装时仍走普通分析并拒绝。
6. **库外全局别名**：`const x = globalThis` 只有在 `x` 在当前可见源码中完全没有引用时
   才替换为可恢复标记，恢复阶段改回 `globalThis`；一旦业务读取该别名就保持原文。
7. **封闭消息对象**：只允许 helper 局部快照参数上的 `status` 写入；直接写宿主
   `$response.status`、`$response.statusCode`、未知 callee、对象逃逸、动态成员和
   headers 方法调用仍然拒绝。
8. **封闭 Env 别名**：`(alias = instance).method` 和 `method.call(alias, ...)` 只在
   alias 单次写入、全部引用是静态成员或 `.call` 首参、无重绑/动态成员/方法写入/逃逸
   时参与折叠；否则整族拒绝。

### 双向反例

新增 `tests/test_node_browser_dead_branches.py`，正向覆盖平台 switch、Node
`require` 死分支、`globalThis.process/window` 探测和本地同名绑定；反向覆盖：

- 探测结果传入未知函数；
- 可达的 `globalThis`/浏览器分支；
- `require()` 结果参与业务；
- `process.env` 影响业务；
- `globalThis`/`window` 写入；
- `globalThis[key]` 动态成员；
- `globalThis.process` 直接作为业务值。

另有既有 `test_window_fallback_folding`、`test_multi_platform_env`、
`test_closed_message_objects`、`test_public_libraries` 的双向回归。

### 未通过的下游层

剩余 10 个目标脚本没有在放宽边界的前提下硬凑成功，当前首阻塞如下：

| 源文件 | 当前首阻塞 | 判定 |
| --- | --- | --- |
| `1a3251d4900a71af.js` | `dt($request)` 整体传递并修改 headers/body | 可达宿主请求修改，拒绝正确 |
| `bc599fd45d7145d9.js` | HTTP 请求声明后被修改（offset 约 91638） | 需要独立 live request 证明 |
| `a274a723dd76f7b5.js` | 写入 `$response` 宿主对象 | 拒绝正确 |
| `d59d28a0de8558fd.js` | 完成结果形状无法静态确定 | 后续完成传播层 |
| `196340e065078c7d.js` | `globalThis._fi11_vid = o` 真实全局写入 | 拒绝正确 |
| `2545ad685f70738b.js` | Env 绑定存在更早 `f = null` 写入，随后 `$done` 调用者不可解析 | 拒绝正确 |
| `b169b9bd81b670b1.js` | 完成结果形状；可达 `$response` 包装 | 拒绝正确 |
| `07da264c8f8eeda1.js` | 可达 `= window` catch 回退 | 拒绝正确 |
| `7c129fc9129dcfcc.js` | DOM/CryptoJS/localStorage | 宿主能力不可证明，拒绝正确 |
| `e67757fe27d87eca.js` | 可达 `= window` catch 回退 | 拒绝正确 |

### 验收记录

| 指标 | 第十一轮基线 | 第十二轮 | 变化 |
| --- | ---: | ---: | ---: |
| URL 成功 | 46/109 | **48/109** | **+2** |
| 组合成功 | 138/327 | **144/327** | **+6** |
| 成功 URL 回退 | — | 0 | 0 |

新增成功 URL（三格式全部通过）：

- `https://raw.githubusercontent.com/ios151/Rewrite/main/luolita/dist/luolita.js`
- `https://raw.githubusercontent.com/ios151/Rewrite/main/porntube/dist/porntube.js`

两个 URL 均在 `qx`、`surge`、`loon` 上用明文响应做了 `verify.compare` 行为差分，
结果均为 `passed`、`differences=[]`。

全量单测：`539` tests，`38` failures；失败测试名集合与干净 HEAD `01f2e3a`
的 `525` tests / `38` failures 相比 `diff=0`，本轮没有新增失败。既有失败属于其他
并行工作流，本轮未修改。

## 结论

运行环境族 21 个 URL 中，能在不放宽拒收边界前提下静态证明的只有“标准回退链、封闭成员探测、封闭 Env 探测方法”这类局部结构；它们单独都不能把任何一个 URL 推到 E2E 成功，且会暴露新的独立证明族。因此本轮保持拒绝，不为单个脚本加特例，也不把平台对象映射到未经验证的 `ctx` 字段。
