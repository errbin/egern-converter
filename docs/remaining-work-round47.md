# 第 47 轮剩余脚本评估

基线为 `6d6f71b`。本轮只处理剩余可攻的五个脚本：`NoAds`、`AppraveTask`、
`ximalaya`、`NeteaseMusicVipCrack` 和 `TilingSales_getNav`。所有新增能力均为
通用静态证明，没有脚本特例，也没有扩大 fixture 或宿主动态能力。

## 结果摘要

- `AppraveTask` 的 qx、surge、loon 三种格式均已可转换。
- 其余四个脚本维持拒绝，拒绝依据是缺少静态证明或缺少经真机验证的宿主契约，
  不是解析失败。
- 最终普查为 **285/327 组合（95/109 URL）**，相对基线 gained 6、lost 0。
- 全量套件为 **851 tests、38 failures、67 skipped**；失败集合排序后与
  `round46-final2` 基线 `diff=0`。
- 618 个唯一原生分析作业的耗时普查为 0 timeout、0 process error；最大值为
  **16.380s**。所有超过 10 秒的作业列在下方。

## 耗时核验

用刷新后的 assembled runtime 重跑 `.local/round38-timing.py`，共 618 个唯一
分析作业，单作业硬上限 90 秒。该上限只用于保护计时任务，没有修改
`verify.py` 的预算。`84357f5` 引入的 v5 解码器没有把任何脚本推近 60 秒。

| 脚本 | 格式 | 耗时 |
| --- | --- | ---: |
| `xv.js` | surge | 16.380s |
| `haijiao.js` | qx | 15.908s |
| `insav.tv.js` | surge | 15.408s |
| `NoAds.js` | qx | 14.302s |
| `ks_fruit.js` | loon | 14.240s |
| `one_daily_task.js` | surge | 14.200s |
| `zimuquan.js` | qx | 14.026s |
| `haijiaoshequ.js` | loon | 12.666s |
| `ximalaya.js` | qx | 12.551s |
| `mdsq2.js` | loon | 12.484s |
| `m3u.js` | qx | 12.175s |
| `pear.js` | loon | 10.496s |
| `kanlixiang.js` | surge | 10.253s |

## 新增通用能力

### 闭合表写入键隔离

`e0575c9` 将闭合字面量表的写入证明按静态字段隔离：只有写入键可枚举，且与
探测实际读取的字段不相交时，才忽略该写入。动态键、写入探测字段、整体别名
逃逸、未知调用逃逸和可达整表改绑仍然拒绝。新增测试包含静态不相交写入正例，
以及写入探测字段、动态键、整体逃逸、别名写字段等反例。

### 同步探测后的不可达改绑

`bc84afc` 进一步把“不可达”限定在同步执行点：对于已证明同步求值的 IIFE，
仅在调用点之后创建、且不可能被推迟执行的普通函数表达式中的整表改绑可以忽略。
函数声明提升、普通回调、探测前整体逃逸、探测后的可达写入仍全部拒绝。测试
覆盖函数表达式正例，以及提升声明、延迟回调、探测前整表逃逸三条反例。

该判据覆盖了本轮要求处理的“初始化分支后续重赋值”形态，但当前语料上没有仅凭
它新增脚本；`AppraveTask` 的三格式增益来自本轮组合判据。它仍没有解决 `NoAds`
的探测前逃逸，详见逐脚本结论。

### Promise 尾部完成证明恢复

`727a81f` 收窄尾部 `return` 证明后，导致 `fqzm` 的 `var ...; return new
Promise(...)` 形态回退。`38bad28` 恢复为：最后一条语句必须是 `return`，且该
函数所有 `return` 均可证明返回 Promise。新增正例覆盖局部初始化后的末端返回；
反例覆盖缺少末端返回和混入非 Promise 返回。`fqzm` 三格式恢复可转换，最终
普查 lost 为 0。

### 其他配套判据

- `942e483`：只读工厂实例观察按闭合对象处理，拒绝未知写入和逃逸。
- `2b864ac`：HTTP 回调响应对象只用于真值观察时物化为本地快照，未知字段和整体
  逃逸仍拒绝。
- `ac5b1da`：补齐缺失宿全局回退读写边界的反例。
- `324222f`、`727a81f`：收紧并扩展可证明的 regenerator 状态图、异步前缀和
  abrupt 控制流，未证明环路和跨闭包写入仍拒绝。

## 逐脚本结论

### `AppraveTask`

三格式均可转换。qx 使用既有 `$task.fetch` 快照；surge/loon 的
`$httpClient.post` 回调只把响应对象用于真值观察，由响应快照判据生成闭合的
本地响应记录。初始化后续整表改绑不再单独构成阻塞。没有 `AppraveTask` 专用
分支，也没有新增未经真机验证的响应方法。

### `NoAds`

三格式当前首阻塞均为：

`Node/浏览器全局缺失探测结果传入了未知代码，无法证明可折叠：window`

具体形态是 IIFE 内的 `q["GXRsb"]("undefined", typeof window)`。`q` 是封闭
字面量 helper 表，`_doReset` 内另有整表改绑；本轮已能证明“同步探测之后创建
的函数表达式中的改绑不可达”。但该脚本在探测前已把 `q` 整体传给未知方法，
例如 `aC["createDecryptor"](Z,q)` 和 `at["yAEyy"](q,...)`。因此无法排除未知
调用改写 `q["GXRsb"]`，也就不能把探测结果安全折叠。

**正式拒绝依据**：缺“探测前整表逃逸不会改写被探测 helper 字段”的证明。若
补上该证明，后续仍需 Egern `globalThis`/crypto provider 的真机契约，以及动态
请求/响应字段的闭合证明；当前没有可验证依据，不能靠脚本特例放行。

### `ximalaya`

三格式当前错误均为：

`global；process；require；setInterval；window`

逐项评估：

- `global`、`process`、`require`、`window`：用于 Node/CommonJS 环境与模块分支。
  Egern 没有经真机验证的 `require`/`process`/`global`/`window` 契约。项目已能
  证明“缺失全局读取的静态探测结果”可折叠，但这里的环境分支会进入未知模块或
  未知代码，不能证明该分支不可达，也不能把未知宿主对象当作已存在能力。
- `setInterval`：周期回调调用 `_0xd9cb26`；同一函数另有显式调用，函数体约 16k
  字符并包含大量可观察操作。源码没有 `clearInterval`，也没有证明回调无业务
  副作用、必定终止或可安全丢弃。不能把周期调用一对一改成一次 `setTimeout`。

**正式拒绝依据**：缺“Node/CommonJS 分支静态不可达或由已验真机契约替代”与
“周期回调无副作用且可证明终止”两项证明。两项都不能在本项目当前证据边界内
合法补出。

### `NeteaseMusicVipCrack`

三格式当前首阻塞均为：

`Node/浏览器全局缺失探测结果传入了未知代码，无法证明可折叠：process`

`process` 探测结果流入未知代码，不能仅按缺失全局折叠。即使绕过该首阻塞，
`setInterval(_0x4d41bf, ...)` 仍在：同一行直接调用 `_0x4d41bf()`，函数体包含
`debugger`、递归自调用和对象重排，属于可达的自防御代码。删除周期调用会改变
原脚本的可观察执行序列，而当前没有该回调不可达、无副作用或必定终止的证明。

**正式拒绝依据**：缺“`process` 探测结果只进入可折叠观察点”与“周期自防御
调用与完成/业务状态无关或不可达”两项证明。没有新增脚本级产物。

### `TilingSales_getNav`

三格式当前错误均为：

`global；globalThis；require；setTimeout`

`globalThis.crypto`、`global.crypto` 和 `require("crypto")` 位于 JSEncrypt 的
crypto provider 回退链；项目没有 Egern crypto 全局或模块加载的权威真机契约。
`setTimeout` 同时来自 browserify 的 `process.nextTick` timer shim 和 crypto-js
的异步大数路径。没有证明这些路径在当前业务分支不可达，也不能把异步取数改为
同步。

**正式拒绝依据**：缺“crypto provider 真机能力”与“browserify/crypto-js timer
路径不可达”两项证明。未以放宽宿主边界换取转换数。

## 本轮脚本级结果

- 新增可转换：`AppraveTask` surge、loon；qx 保持可转换，共 gained 3 组合。
- 同轮回归恢复：`KDF/m3u.js` 三格式，共 gained 3 组合。
- 维持拒绝：`NoAds`、`ximalaya`、`NeteaseMusicVipCrack`、
  `TilingSales_getNav`。
- 最终 gained 6、lost 0；普查从 279/327、93/109 提升到 285/327、95/109。
