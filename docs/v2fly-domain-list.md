# v2fly domain-list 规则源

转换器按内容识别 `v2fly-domain-list`，不检查仓库名或文件名。支持 `domain`、`full`、`keyword`、`regexp` 和 `include`，输出使用 Egern 原生规则集字段：

| 上游 | Egern |
| --- | --- |
| 裸域名、`domain:` | `domain_suffix_set` |
| `full:` | `domain_set` |
| `keyword:` | `domain_keyword_set` |
| `regexp:` | `domain_regex_set` |

`include` 在调用方提供的仓库文件字典内递归解析；缺失目标、歧义目标、循环和错误语法都会带文件路径与行号报错。`@must` / `@-ban` 按上游语义过滤：无属性条目只受 `must` 约束，有属性条目必须同时满足 `must ⊆ attrs` 且 `attrs ∩ ban = ∅`。展开后再丢弃属性与归属标注。

## regexp 原样透传

Egern 官方 DNS 文档明确 `domain_regex` 使用 PCRE2，并按 **find / 搜索语义**匹配：任意子串命中即匹配。v2fly 的 `regexp:` 使用 Go `regexp.Compile` 校验、`MatchString` 匹配，同样是搜索语义。两侧语义一致，因此转换器不再做任何归一化：

- `regexp:` 的值原样写入 `domain_regex_set`，不改写 `^`、`$`、`(^|\.)` 或前缀。
- Python `re.compile` 只用于语法校验；校验通过后返回原字符串，不执行匹配。
- 除语法无效外，不以“未锚定”“无法证明整串等价”等理由拒绝 regexp。
- Python 与 Go RE2/PCRE2 的语法集合不完全相同；若出现 Python 无法编译但 Go 可以编译的模式，应作为工具差异单独判定并报告，不能静默归为上游错误。

2026-11-18 的 1557 个离线文件共有 163 条 regexp 出现（163 条唯一模式），转换后 163/163 收录，拒绝 0 条，Python 与 Go 编译结论不一致 0 条。逐条把转换输出与上游原串做 `re.search` 搜索语义比对，mismatch 为 0。

### 性能提示

上游存在嵌套重复模式（例如 `data/okaapps` 第 4 行的 `^(.+\.)*zh\.okaapps\.com$`）。这类模式在回溯引擎上遇到长近似不匹配输入时可能触发灾难性回溯。转换器只编译、不执行匹配，因此转换期不受影响；运行 `domain_regex` 的宿主应使用引擎超时或输入长度限制。性能风险不得成为拒绝、改写或丢弃该模式的理由。

## 冗余规则

本转换器不裁剪被父后缀覆盖的子域或 `full:` 重叠规则。这样避免属性过滤、`full:` 与 `domain:` 混用时因裁剪改变语义；代价是约 5% 的额外 YAML。相同 key/value 仍会去重。

## 输出路径

规则集按上游 basename 输出，例如 `geolocation-!cn.yaml`，不额外保留 `data/` 层级。`!` 是合法 POSIX 路径字符，文件名本身不编码；上游 URL 继续由 `quote(..., safe='/')` 编码为 `%21`。若同一来源存在重名 basename，则回退到上游完整相对路径，避免输出碰撞。
