# v2fly domain-list 规则源

转换器按内容识别 `v2fly-domain-list`，不检查仓库名或文件名。支持 `domain`、`full`、`keyword`、`regexp` 和 `include`，输出使用 Egern 原生规则集字段：

| 上游 | Egern |
| --- | --- |
| 裸域名、`domain:` | `domain_suffix_set` |
| `full:` | `domain_set` |
| `keyword:` | `domain_keyword_set` |
| `regexp:` | `domain_regex_set` |

`include` 在调用方提供的仓库文件字典内递归解析；缺失目标、歧义目标、循环和错误语法都会带文件路径与行号报错。`@must` / `@-ban` 按上游语义过滤：无属性条目只受 `must` 约束，有属性条目必须同时满足 `must ⊆ attrs` 且 `attrs ∩ ban = ∅`。展开后再丢弃属性与归属标注。

## regexp 归一化

Go 的 `regexp.MatchString` 是搜索语义，Egern 官方文档没有写明 `domain_regex` 是否整串匹配。为避免依赖未公开细节，转换器只输出在两种语义下等价的模式：

- `^...$`、`.*...$`、`.+...$` 原样保留。
- `(^|\.)...$` 改写为 `(^|.*\.)...$`：整串语义下 `.*\.` 吸收到最后一个点，搜索语义下仍可从点后开始。
- 其他以 `$` 结尾的未锚定模式前置 `.*`，让整串语义显式吸收任意前缀。
- 不能证明等价的模式（例如既不吸纳前缀也不以 `$` 结尾）按文件与行号拒绝。

2026-11-18 的 1557 个离线文件中，163 条 regexp 全部可归一化：18 条原样保留、144 条 `(^|\.)` 前缀改写、1 条 `kinopub` 模式前置 `.*`；没有 regexp 拒绝文件。

## 冗余规则

本转换器不裁剪被父后缀覆盖的子域或 `full:` 重叠规则。这样避免属性过滤、`full:` 与 `domain:` 混用时因裁剪改变语义；代价是约 5% 的额外 YAML。相同 key/value 仍会去重。

## 输出路径

规则集按上游 basename 输出，例如 `geolocation-!cn.yaml`，不额外保留 `data/` 层级。`!` 是合法 POSIX 路径字符，文件名本身不编码；上游 URL 继续由 `quote(..., safe='/')` 编码为 `%21`。若同一来源存在重名 basename，则回退到上游完整相对路径，避免输出碰撞。
