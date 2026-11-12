# 原生转换的配置边界

转换器自行解析、生成 Egern 配置及原生 `ctx` 脚本，不依赖 Script-Hub 的服务、运行时代码或兼容层。Script-Hub 本地源码中的 Header Rewrite 解析和平台输出分支仅用于理解输入格式；目标行为以官方文档为准。

## 已补充的通用语法

- Surge 最后一个脚本选项使用外层双引号包裹 JSON `argument` 时，保留内部引号、逗号、嵌套对象和模块占位符。先以占位值校验 JSON 结构，不执行表达式。
- 模块参数可以不提供默认值，保留为空字符串；重复参数和无效 JSON 继续拒绝。
- MITM `%INSERT%` 与 `%APPEND%` 列表标记转换为模块内域名列表；不把标记当域名。
- URL Rewrite 支持 `_ reject` 与 `- reject`。
- Surge Header Rewrite 在自动发现构建中编译为原生 `ctx.request/response.headers` 脚本。通过 `has/getAll/set/append/delete` 保留缺失头、已有头、多值头以及规则顺序；模块参数通过 `env` 传入。原生侧车脚本按作者、仓库、模块名称存放，独立的对象参考模型用于差分验证。
- 平台识别仅将包含 `script-path` 的经典 `http-request/http-response` 脚本声明判为 Loon；头部规则不再触发误判。
- 带有实际 HTTP 重写／脚本规则的模块可以解析 `force-http-engine-hosts` 域名列表：目标使用 Egern 原生 HTTP 处理链，保留重定向、处理规则和 MITM，不生成抓包配置。无关联处理规则的独立引擎指令、带端口的特殊流量仍明确报错。
- `$utils.ungzip` 静态编译为 `await ctx.compress.gunzip`。局部别名、平台能力检测及可追溯的调用链自动处理；同步函数沿调用链改为异步并等待结果。输入按二进制视图转换，不注入平台对象。无法证明异步回调语义时拒绝输出。
- 无方法重写、原型操作或接收者逃逸的本地对象／类方法参与完成结果和异步传播分析；保留原有业务方法和 `this`，不把平台全局 `this` 当作普通对象。
- 打包脚本中的单例平台客户端通过作用域和方法 AST 契约识别，不按作者、URL 或文件名挑选。局部变量改名、空白和注释不影响方法匹配；未知方法实现、客户端逃逸、字段副作用、重新赋值或不明确的工厂参数会拒绝转换。构建直接展开已确认的平台分支，删除客户端类与工厂，把业务代码中的访问改为原生 `ctx` API，不发布客户端封装。
- 已匹配客户端的复杂流程支持条件完成、普通返回与完成返回混用、静态分发表，以及明确的 `then/catch/finally` 链。局部变量暂存原生完成值，逐层返回；提前完成后跳过兜底路径。压缩调用的异步性质沿函数调用链传播。未知高阶回调、可修改的分发表及无法确认求值顺序的表达式继续报错。

## 配置注释

非原生模块的文件头只包含来源署名、原文开头的说明和 `remark`／`note`；已映射到原生字段的元数据不重复显示。各配置段的注释在解析时关联到随后生成的配置项，序列化后仍位于该项之前，支持复制和后续名称／说明更新。注释不参与 YAML 配置值，不经过卡片说明的主机名清理器，避免破坏技术说明中的 `hostname`、主机名或 MITM。移除争执文字与已失效的其他平台专属 FAQ；原生 Egern 正文继续逐字保留。

## 静态字段与原生脚本的选择

经典 Loon 声明遗漏功能参数时，构建可追溯同一原作者仓库中引用**同一脚本 URL、同一参数**的配套模块，从 `[Argument]` 读取类型、默认值、选项和说明。仅补全缺失声明，本地声明优先；配套模块声明冲突时拒绝猜测。报告记录源 URL、行号与正文摘要，配套模块加入构建依赖，原文缓存支持后续离线构建。例如 Sparkle 的 `optimizeRequest` 是“优化评论区加载”功能开关，默认值来自作者配套模块，不是转换器预设的语法开关。`argument=[{a}, {b}]` 与对象参数写法均保留布尔、数值和字符串类型。

同一模块的同一脚本可以同时用于有对象参数、无参数、带启停开关的规则：构建合并可共用的编译契约，各条规则的 `env` 独立保留。解码时保留未传参和空字符串，`typeof $argument` 在运行时判断；没有读取参数的脚本不生成解码代码，继续共用相同文件。若同一脚本还需原始字符串参数，或使用未知参数契约，仍拒绝合并，避免改变类型。

跨模块的字符串参数与对象参数可以分别编译。像贴吧原文有针对两种类型的不同业务分支时，原生产物可以不同，继续沿用上游文件名，在 `variants/<参数契约>/` 下区分；仅正文逐字相同的产物共用物理文件。文件名与内容共享验证按这项契约判断，不要求所有参数类型生成相同代码。

`createInstance` 继承客户端和中间件收尾链按方法 AST 契约自动处理：等待原路由调度、在收尾中返回最终修改值、入口再返回该结果；业务路由和公共 protobuf 代码继续来自原文。两个 protobuf 脚本使用作者自带的 Surge 默认分支编译，保留可选 trailers 检查及缺失时的 gRPC 状态回退。HTTP 调用直接生成 `ctx.http`，二进制正文使用 `arrayBuffer()`，超时由秒转毫秒，不复制 Loon 专用的强制 ALPN 选项。转换结果与作者 Surge 行为作差分验证，不声称与 Loon 扩展能力完全相同。不能把编译器的拒绝当作 Egern 缺乏能力的证明。


### HTTP/2 字段核查（2026-11-04）

- [Egern 原生 API 文档](https://egernapp.com/docs/javascript-api/) 的 `ctx.request`、`ctx.response`、`ctx.http` 响应与请求选项未列出 trailers 或 ALPN 控制。这个证据只能证明**未公开文档化的直接映射**，不能证明运行时、HTTP 协议栈或兼容层不支持 HTTP/2，也不能证明不存在其他处理方式。
- Sparkle 原文的工厂在 `$loon` 存在时选择 Loon 子类，否则（排除 Quantumult X）选择 Surge 基类。`alpn="h2"` 只由 Loon 子类的 `fetch` 添加；Surge 基类不设置该选项。因此“脚本必须强制 ALPN h2”不是跨平台成立的结论。模块来自 Loon 不等于 Egern 兼容运行时一定选择 Loon 分支。
- 公共中间件对 `response.h2_trailers !== undefined` 做可选能力检查；没有该字段且请求 `te` 为 `trailers` 时，作者已有补充 `grpc-status: 0` 的回退（保留已存在的状态）。这说明字段存在并非所有路径的必要条件，但尚不能证明回退与真实 trailers 在所有 gRPC 响应上等价。请求脚本还有转发 HTTP 响应的 trailers 赋值，应与只读能力检查分别分析。
- [Surge HTTP 客户端文档](https://manual.nssurge.com/scripting/api.html) 列出响应 `status`、`headers` 和独立的正文，未列出 `h2_trailers`；[Loon 文档](https://nsloon.app/docs/Script/script_api/) 则明确列出该字段。这与作者提供 Surge 回退一致，但不构成对 Egern 实现细节的确认。
- [Egern FAQ](https://egernapp.com/docs/faq/) 确认支持导入 Surge 模块，未公开上述兼容字段到原生字段的对应实现。维护者反馈原脚本可以兼容运行，应作为有效线索；当前没有取得该次运行的平台工厂选择、实际 trailers 输入及转发结果，不能声称已完成真机验证。

当前转换器按经过 AST 契约审核的工厂自动选择作者的 Surge 默认协议；模块来源格式继续保留，报告另记 `verification_format: surge`，构建验证与模块审计都使用同一基准。未注入兼容 API，也不虚构 `ctx.response.h2_trailers` 或把普通 headers 当作 trailers。原生消息仅包含公开字段，作者的能力检查和缺失回退保留原文；这不证明 Egern 兼容层实际也选择 Surge 分支。

gzip 回归还要求已有 async 中间件内等待新异步化的解压函数；保持赋值左值与条件分支原本的求值顺序，不把整个中间件误判为新异步回调。

Surge 单独 `header-add` 会追加多值头，`header-replace` 在原字段缺失时不执行。Egern 的 `add` 和 `replace` 都会在缺失时新增字段，因此不直接映射到静态字段，而通过原生请求／响应脚本实现精确条件。独立 CLI 的纯 YAML 输出仍不擅自丢弃这些条件；需要使用仓库构建发布配套脚本。

`extended-matching` 增加对 TLS SNI 和 HTTP Host 的匹配范围。不能直接删除此标记，也不能凭普通域名规则推定等价。

`force-http-engine-hosts` 强制指定流量进入 HTTP 引擎；Egern 的 `http_captures` 是流量记录功能，不能拿来替代。依据维护者提供的 Egern App 导入结果，Surge `[Host]` 中的 `域名 = script:名称` 可解析为 `dns.hosts`，`type=dns,engine=jsc` 可解析为同名 `generic` 脚本；保留模块参数、域名模式及参数 JSON。原生脚本参数使用 `env.argument`，不生成 `_compat.$argument`。未知引用、重复映射、未知选项和非 JSC 引擎继续拒绝。该配置映射不证明关联脚本已经原生化。

Alidns 原文仍读取 `$domain` 并返回 `{addresses, ttl}`。截至本次核查，公开原生 API 文档只列出 Generic 的 Widget 返回值，没有说明 DNS 调用的原生域名输入及返回契约；维护者也未提供原生 DNS 示例，并明确选择“继续要求纯原生，暂不发布”。因此构建识别关联脚本后，报告缺少上述契约并排除整个模块，不沿用原始 Surge 脚本、不加入兼容层，也不猜测 `ctx.domain`、`ctx.env.domain` 等字段。阿里 JSON DoH 按查询域名和时间动态签名，不能用固定 DoH 上游替代。

复杂对象方法中的完成结果、动态属性和平台环境封装仍需静态数据流证明。解析模块成功不表示关联脚本已转换成功；关联脚本失败时整个模块不发布。原因记录在 `dist/build-report.json`。


## 转换回归测试

转换器测试覆盖静态契约、控制流、客户端字段映射及不安全变异拒绝。网站构建使用模块规则和原脚本 AST 自动生成的探针；没有可生成输入的业务分支明确保持未覆盖。

重新抓取或首次构建仍使用统一来源流程，不需要 AI 编辑脚本。

## 压缩与调用链验证

差分验证器按请求／响应二进制输入使用 Python 标准库 gzip/zlib 生成限长字节向量，通过 JSON 注入隔离 VM，分别供原平台同步 API 和 Egern 异步 API 使用。包括真实 gzip 数据解压、无效流的 `null`、函数／对象／类方法调用链及能力检测。

## 参考

- [Egern 头部重写](https://egernapp.com/zh-CN/docs/configuration/header_rewrites/)
- [Egern 模块参数](https://egernapp.com/zh-CN/docs/configuration/modules/)
- [Egern JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)
- [Surge Header Rewrite](https://manual.nssurge.com/http/header-rewrite.html)
- [Surge 模块参数](https://manual.nssurge.com/profile/module.html)
- [Surge 规则参数](https://manual.nssurge.com/rules/overview.html)
- [Surge JavaScript API](https://manual.nssurge.com/scripting/api.html)
- [Egern URL 重写](https://doc.egernapp.com/zh-CN/docs/configuration/url_rewrites/)
- [Script-Hub](https://github.com/SCript-Hub-Org/Script-Hub)

## Cookie SDK 与模块阶段

模块依赖的执行阶段由声明自动提取，同一 URL 在所有模块中的阶段取并集；存在未知阶段时不做阶段特化。只有请求入口的脚本可排除其定时任务入口，但仍保留同一请求阶段下的 URL、OPTIONS、存储和通知分支。清单不登记人工转换结果。

编译器对封闭的对象工厂、构造器和类工厂做作用域分析，将可追溯方法及捕获状态展开为普通局部函数与变量，然后直接生成 `ctx.storage`、`ctx.notify`、`ctx.http` 和原生返回值。构造器中的日志、存储和初始化顺序保持；只删除经静态证明无外部副作用且无使用者的客户端分配。重新赋值、别名逃逸、方法覆写、动态字段及无法确认的回调均不能因 SDK 名称相同而放行。

同一 HTTP 辅助函数的不同回调可分别做封闭调用点特化，保留参数求值及词法捕获；请求参数、响应正文和状态归一化仍来自原代码。根入口在互斥分支启动一个完成任务、之后只初始化纯标量时，保留任务启动位置，初始化后再等待其结果；多个并发完成任务或启动后的可观察操作继续拒绝串行化。

单一封闭类实例的 getter/setter 可展开为局部函数调用，保留 setter 赋值表达式的返回值。实例和 `this` 不得逃逸到反射、别名或未知函数；只读属性赋值、动态更新与删除继续拒绝。方法仅以 `arguments.length` / 常量下标读取参数时，可改为 rest 参数与局部解构，保留实际参数数量、显式 `undefined` 和默认值；严格模式中的隐式全局写入不会被修复为合法局部赋值。

封闭请求辅助函数返回 `Object.assign({}, input)` 的副本时，可追溯 URL、headers、body 及原有选项键，实际复制与头部处理仍执行原代码。未知字段、对象逃逸和条件修改布尔选项不推断为固定值。通知辅助函数返回的封闭普通对象同样按实际返回对象读取字段，保留参数求值顺序，省略未定义的链接与附件。

`eval`、`Function`、`toString` 等 JavaScript 原生能力保持原调用，不作为旧平台 API 转写，也不因出现这些名称而拒绝转换。完整的 Base64、CryptoJS、protobuf 等已识别第三方库在数值、平台分支及其他优化之前提取，原始库块逐字恢复；库声明不能掩盖业务代码中的旧平台 API。

直接 eval 的词法引用参与绑定保留与初始化分析。存储数据的 JSON 写入契约只用于分析，不再把 eval 替换成 JSON.parse。可见字面量中包含旧平台 API 时应单独报告未完成的 API 映射；未知动态文本、严格模块的声明作用域差异、动态访问已展开的旧 SDK 和函数源码自检不构成全输入等价证明。

QX 入口对 `$done` 的唯一同步包装，只有在原始快照声明唯一、包装参数不重绑也不逃逸、包装器恰好原样委托一次，并且所有完成调用都保持单参契约时才消除；默认值 `{}` 由无参或显式 `undefined` 调用补回。由 `$prefs` / `$persistentStore` 组成、只被闭合 `get(key)` / `set(key, value)` 调用的顶层存储门面，可投影为原生存储调用并保持 `(value, key)` 顺序。多平台通知同时提供 `open-url` 与 `url` 时，只有所有字段都是同一个静态字符串才合并；别名、动态成员、额外字段或冲突值继续拒绝。

`cookies.plugin` 的依赖可用以下命令独立检查，未完成的依赖不会作为兼容脚本兜底发布：

```sh
.venv/bin/python -m tools.egern_hub.audit_module \
  https://github.com/fmz200/wool_scripts Loon/plugin/cookies.plugin \
  --offline \
  --output verification/local/cookies-audit.json
```


定时入口的完成值直接作为 JavaScript 返回值保留，包含面板、自定义字段及其求值过程；不按 HTTP 响应补丁解释，也不表示 Egern 会显示其他平台的面板。混合入口与 HTTP 入口继续按各自响应字段契约检查。

完整库可保留已初始化的外部词法依赖，防止编译期间误删字符串表别名。带字符串表的完整 JSEncrypt 库保留原文，在外层声明其原有隐式数据绑定以适应原生模块的严格模式。业务中的常量字符串查表通过有界标量运算解析，不执行输入函数；动态 eval 可观察的查表绑定不参与此项简化。

已审查且封闭的 Loon HTTP 工厂保留顶层 `accept` 数据的求值与合并，但不会将它猜测为 `Accept` 请求头。报告在 `ignored_request_fields` 中记录这一非传输字段；其他未知字段继续拒绝。
