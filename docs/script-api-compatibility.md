# 脚本原生 API 转换说明

非原生 Surge / Loon / Quantumult X HTTP 脚本通过 Acorn AST 静态编译成 `export default async function(ctx)`。产物直接使用 Egern 官方 `ctx` API；不定义旧平台全局变量，不附带兼容 runtime、完成信号、Promise 跟踪器或远程适配器。原生 Egern 脚本及模块正文原样保留。改写脚本使用块注释记录原作者、来源、许可名称和 ErrBin 署名；有实际许可证时附其正文。标为“未声明许可证”或“待核验”的仓库来源说明只保存在 `licenses/`，不逐份注入脚本。保留上游功能说明、署名与法律声明，旧平台配置用法由构建自动替换为 Egern 用法。

生成文件将署名与许可、原脚本开头的功能说明、“用法”及原生 YAML 配置依次合并为一个块注释，再输出原生入口及执行代码。编译器按 AST 中首条语句的位置提取开头注释，保留说明行内容，不把入口和正文读取插在说明之前；业务代码内部的注释留在原位置。配置前保留空行，地址统一读取 `site.json` 或构建参数。

转换后的执行代码跟随上游布局：忽略说明注释及空行后，如果原文的全部代码令牌位于同一行，则输出单行执行代码；多行原文使用两空格缩进。原生 Egern 文件仍原样保留。静态解混淆前保存原文布局，因此解混淆不会使单行脚本改用多行输出。单行输出中的业务注释移入顶部统一说明块，署名、说明及用法 YAML 保持可读。单行压缩只整理空白和分隔符，不重命名变量或改写业务表达式，并重新比较语法树；多行格式化同样先后校验语法树。先将解析器自动插入的分号显式补齐，保护依赖换行的 return / break / continue 等语句；格式化前后重新解析并比较语法树，保留字面量原文、模板内容及指令，同时检查业务注释内容，发现差异就拒绝输出。格式化工具随构建源码提供，不需要额外安装 npm 依赖，不注入生成脚本；原生 Egern 作者文件保持原样。

用法识别针对 Acorn 解析出的注释，分别识别 QX 的 `url script-*`、Loon 的 `http-request/http-response ... script-path=`、Surge 的 `名称 = type=...`，兼容带段名、无段名和逐行注释；不修改字符串或正则中的同名文本。构建从实际发布模块提取脚本阶段、名称、匹配式、正文选项、环境参数与 MITM 配置，并使用当前站点的模块和脚本地址生成原生 YAML 说明。共享脚本列出所有配套模块。单文件命令没有配套模块上下文时只生成通用 Egern 配置说明，不猜测域名或触发条件。预览服务中的说明链接跟随局域网 / Tailscale 请求地址。

例如：

```js
// 转换前
const data = JSON.parse($response.body);
data.ok = true;
$done({body: JSON.stringify(data)});
```

```js
// 转换后（省略署名及未完成路径的错误提示）
export default async function(ctx) {
  const responseBody = ctx.response?.body == null ? undefined : await ctx.response.text();
  const data = JSON.parse(responseBody);
  data.ok = true;
  return {body: JSON.stringify(data)};
}
```

## 原生映射

| 原脚本接口 / 行为 | 编译结果 |
| --- | --- |
| `$request` / `$response` 的 URL、方法、状态、请求头 | 直接读取 `ctx.request` / `ctx.response` 对应字段 |
| 请求 / 响应正文 | 按实际使用生成局部正文变量，通过 `.text()` / `.arrayBuffer()` 单次读取 |
| `$done({…})` | 原生 `return`；嵌套完成函数的调用点同步改成返回，传播到入口 |
| 请求阶段的合成响应 | `return ctx.respond({…})` |
| `$done({abort:true})` | `return ctx.abort()` |
| `$httpClient.get/post/put/delete/head/options/patch` | 原生 `await ctx.http` 调用；将回调正文移入当前流程，传输错误与业务异常分开处理 |
| `$task.fetch` | `ctx.http` 对应方法；响应直接使用原生 status / headers / 正文方法，不构造旧响应对象 |
| `$persistentStore` / `$prefs` | 直接调用 `ctx.storage.get/set/delete` |
| `$notification.post` / `$notify` | 直接调用 `ctx.notify({title, subtitle, body, action, attachment, sound})` |
| `$utils.geoip/ipasn/ipaso` | `ctx.lookupIP` 对应字段 |
| `$argument`、`$environment.variables/language` | `ctx.env.argument`、`ctx.env`、`ctx.app.language` |
| `$loon` / `$environment['device-model']` 的设备分类、`$environment.system` 的 iOS/macOS 判断 | 经使用路径检查后读取模块参数 `ctx.env.EGH_DEVICE_TYPE`；iPhone / iPad / Mac 三选一 |
| `$script.name`、`$cronexp`、网络字段 | `ctx.script.name`、`ctx.cron`、`ctx.device` 对应字段 |

只按实际需求生成正文、字节和通知处理表达式。Headers 使用 Egern 自身的大小写无关属性访问，不创建 Proxy 或请求 / 响应快照。替换正文时移除旧长度及编码头；ArrayBuffer / TypedArray / DataView 转成原生接受的 Uint8Array，并保留偏移和长度。

普通 JavaScript 语法与平台 API 分开判断。错误对象、普通类实例、URL 等对象的 `toString()` 用于格式化时允许保留；函数源码自检仍需明确接收者。`Object.create` 属性访问器和未逃逸的内建方法别名按作用域证明，不因为存在 `this` 就拒绝整个脚本。已审查 protobuf-ts runtime 相邻的 MessageType schema、实例与枚举声明通过结构和依赖检查后逐字保留，避免强行改写 `int64().toString()` 等生成代码。

HTTP URL 可沿未逃逸的局部函数参数追溯，包括 JSON 数据中字符串操作产生的 URL；对象改写、别名逃逸、JSON reviver 和未知调用不提供类型证明。条件构造的通知 URL / 媒体字段只在确实写入时生成原生 action / attachment，直接调用 `ctx.notify`，不注入通用选项适配器。

### 临时设备类型参数

当前公开原生 API 没有设备型号 / 系统类型字段。对于确实读取设备分类的脚本，构建根据编译器返回的 `device_type_parameter` 自动给配套转换模块增加 `env_schema.EGH_DEVICE_TYPE` 选择器，选项固定为 **iPhone、iPad、Mac**，默认 **iPhone**。在 Egern 模块设置中按实际设备选择；iPad 和 Mac 用户需要切换一次。模块级 `env` 优先于脚本级默认值，不需要修改脚本。默认同时写入对应脚本的 `env`，因为官方文档说明 `env_schema.default_value` 只是界面提示，未选择时不会写入运行环境。既有参数与其他脚本保持原样，原生 Egern 模块逐字保留。

编译器从硬件读取点沿局部变量、赋值、返回值和可追溯函数调用检查所有用途，只允许设备分类前缀 / 正则判断，以及 iOS/macOS 比较；不把三个类型冒充具体型号或版本，不生成 `$loon`、`$environment` 或运行时兼容层。非法选项明确报错。配置键与原脚本或模块冲突时拒绝覆盖。无法证明用途的设备读取仍拒绝转换。

设备参数映射集中于 `tools/js-analysis/platform/clients.mjs`，模块选项与验证输入集中于 `tools/egern_hub/device_parameters.py`。待官方发布原生设备类型接口后，在这里替换读取方式、移除选择器，再全量重转和验证；当前不会猜测未来的 `ctx.device` 字段。

参数语法和默认值行为依据 [Egern 模块文档](https://doc.egernapp.com/zh-CN/docs/configuration/modules/) 与 [环境变量文档](https://doc.egernapp.com/zh-CN/docs/configuration/env/)。

编译前静态消除来源平台分支，尊重词法作用域；作者的局部变量不会被误当成平台接口。编译后再次解析并检查自由标识符，禁止残留旧平台 API。`--no-ast` 为旧调用保留参数兼容，但不能关闭原生编译或恢复兼容产物。

平台标识与设备数据分开处理：`typeof $loon` 仅在 Loon 来源分支成立，Surge 来源会静态删除该分支；`$notify` 只用于 QX 平台识别，不能在 Surge / Loon 中假定存在。版本字段可用于已知平台的存在性判断，但不虚构具体版本或字段类型。只传播已初始化、未重赋值的常量及可证明无副作用的零参数谓词；未知平台、设备型号与业务版本比较保持未知，不填空字符串或固定手机型号。

无状态、未逃逸的对象式 Env 工厂由 AST 自动建立方法调用图：保留实际使用的方法正文，内部 `this.method(...)` 静态展开为局部函数调用，移除未使用的 Node / 其他平台实现，再转换实际 API。构造器副作用、动态访问、状态字段、方法改写与对象逃逸不走此路径。已审查的 Chavy Env 构造器、辅助闭包和使用方法继续匹配语义契约，但不再要求整个类的未调用方法逐字匹配；新增未调用的设备或平台探测不会阻挡完成 / 普通键存储转换，构造器及调用链有变化则拒绝匹配。不会按作者、文件名或方法名称手写替代业务逻辑。

“支持 Egern”的兼容库须区分旧 `$done` / `$notification` 分支与原生 `export default async (ctx)` 入口。前者仍需静态转换，不能作为原生脚本原样引用的依据。

HTTP 参数按来源解释：Surge timeout 秒转毫秒；Loon timeout 已是毫秒，未指定时使用 5000 ms；QX `$task.fetch` 的 timeout 已是毫秒并原样映射。policy、policy-descriptor、重定向、Cookie 和 TLS 选项映射到对应原生字段。QX Cookie 默认关闭，Surge / Loon 默认开启。QX 错误处理中使用的 `error` 字段就地保留；没有通用 HTTP 包装器。QX 正文和 bodyBytes 同时使用时只读一次流，分别解码文本和保留 ArrayBuffer；Surge / Loon 的二进制正文为 Uint8Array。

未提供存储键时按原始 URL 生成本站命名空间；Loon 按 `ctx.script.name` 生成稳定键。不会迁移其他 App 的存储，也不自动解释工具库的 `@key.path` 约定。

## 必须拒绝的流程

原生 `return` 只结束当前函数。转换器分析完成函数及调用关系，只在能够传播返回值时改写。普通脚本采用直接返回路径；已静态匹配的平台客户端还可展开为结构化流程，通过局部完成值逐层返回，处理条件完成与明确的 Promise 兜底链，见[配置边界](conversion-boundaries.md)。以下未被静态证明的情况会给出具体行号与原因，绝不退回兼容层：

- 无法区分普通返回与完成返回，或完成函数引用传给未知高阶函数 / 对象。
- 完成操作嵌入不能保留求值顺序的赋值、参数、Promise 执行器等位置。
- 独立异步任务、无法确定终止顺序的并发任务，以及未被结构化分析覆盖的 then / finally。
- 整体传递旧请求 / 响应对象、逃逸的旧 HTTP 响应、无法追溯形状的完成结果；仅 `response` 键未被业务读取且包装记录封闭流向 Promise resolver 的完整响应例外。
- 动态 HTTP 方法路由、声明后修改的 HTTP 参数对象、动态展开字段、未知 API 或选项。
- 定时器、动态执行、文件系统 / Node 依赖、import/export 依赖打包、未审查的 this、生成器和源码自检。

支持简单异步 IIFE、局部完成函数和别名、显式 await、线性 then/catch 链、独立 HTTP 回调以及静态可解析的 HTTP 方法别名。正文读取和业务条件仍由作者源码决定。静态限制属于当前转换器，不代表 Egern 缺少相关能力；不能转换的自动发现模块进入构建报告，页面不展示其独立脚本。

## 全量重建与验证

```sh
.venv/bin/python build.py --offline --verify
```

每次构建从 `sources/<作者>/<仓库>/` 的原文重新转换当前模块依赖的全部历史脚本。`--offline` 只跳过联网同步，不复用转换结果。本地、GitHub Actions 和 Cloudflare Pages 使用同一规则，无需 npm 运行库或 Script-Hub。

Python 按源码、平台和编译选项去重并分批调用 Node，每批最多 256 项或 8 MiB。所有输出再经过模块语法校验后替换站点。`conversion.json` 记录工具链 SHA-256、原文 / 产物 SHA-256、平台、二进制选项及 `conversion_mode`（`direct-native` / `source-native`），可审计历史脚本是否已全量重转。

验证器在独立模拟宿主中分别运行原文和原生产物，比较结果、请求、存储和通知。模拟宿主为测试提供来源平台 API，**这些测试代码不进入发布脚本**。见 [验证规范](verification.md)。

## 参考

- [Egern 官方 JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)：ctx、Headers、正文流、HTTP、存储、通知与返回值。
- [Surge 官方 API](https://manual.nssurge.com/scripting/api.html)、[Loon 官方 API](https://nsloon.app/docs/Script/script_api/)。
- [QX 官方任务示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-task.js)、[二进制示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-bytes-rewrite.js)。
- [NSNanoCat/util](https://github.com/NSNanoCat/util)、[Script-Hub](https://github.com/SCript-Hub-Org/Script-Hub)：仅供来源语义参考，不作为依赖或兼容运行库。
