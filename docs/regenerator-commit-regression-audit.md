# `727a81f` 回退与 `38bad28` 恢复核对

## 结论摘要

- `324222f`：**282/327 组合、94/109 URL**。
- `727a81f`：**279/327 组合、93/109 URL**，相对 `324222f` **回退 3 个组合、
  新增 0 个组合**。
- 回退完整清单只有 `fqzm.js` 的 qx、surge、loon 三格式，没有其他 key。
- `38bad28`：**285/327 组合、95/109 URL**；`727a81f` 引入的三个回退全部恢复，
  没有“悄悄没恢复”的 key。
- `38bad28` 的直接父提交 `ac5b1da` 上，这三个 `fqzm` key 仍以同一错误失败；
  因而恢复点确实是 `38bad28`，不是更早的提交。
- `38bad28` 恢复后的 `fqzm` 三格式输出与 `324222f` **逐字节相同**（SHA-256
  完全一致），说明恢复方式与原成功路径相同，不是“换了一条路勉强通过”。
- `38bad28` 的保护条件是“最后一条语句必须是 `return`，且该函数所有 `return`
  都可证明返回 Promise”。这恢复了 `324222f` 原有的更宽判据，而不是收窄
  `727a81f` 的新能力；`727a81f` 新增的前缀求值、`abrupt continue/break`、
  零/一条 catch 边和闭合函数/对象方法 Promise 证明在 `38bad28` 上全部保留。

## 核对方法

在三个隔离 worktree 中分别检出提交，使用与第 47 轮最终普查相同的
`/root/egern/.local/impact/run-batch-parallel.py`：

```sh
git worktree add --detach /root/egern/.local/audit727/324222f 324222f
git worktree add --detach /root/egern/.local/audit727/727a81f 727a81f
git worktree add --detach /root/egern/.local/audit727/38bad28 38bad28

EGERN_REPO=/root/egern/.local/audit727/324222f \
  python3 /root/egern/.local/impact/run-batch-parallel.py audit727-324222f.json
EGERN_REPO=/root/egern/.local/audit727/727a81f \
  python3 /root/egern/.local/impact/run-batch-parallel.py audit727-727a81f.json
EGERN_REPO=/root/egern/.local/audit727/38bad28 \
  python3 /root/egern/.local/impact/run-batch-parallel.py audit727-38bad28.json
```

原始结果保存在 `/root/egern/.local/impact/audit727-324222f.json`、
`/root/egern/.local/impact/audit727-727a81f.json`、
`/root/egern/.local/impact/audit727-38bad28.json`；`3699dd0` 行沿用第 47 轮
最终普查，不重复计入本次三提交差分。

普查口径与最终基线一致：109 个 URL × qx/surge/loon，共 327 个
`url||format` key；`binary=false`、`entry_types=['http_response']`，记录每个 key
的 `errors` 与 `ok`。这是静态原生转换普查，不是运行时等价证明。

为核对恢复点，另外在 `ac5b1da`（`38bad28` 的直接父提交）上只重跑了三个
`fqzm` key；为确认 `AppraveTask` 增益的归属，在 `942e483`、`2b864ac`、
`ac5b1da` 上分别重跑了 `AppraveTask` 三格式。

## 提交链

从旧到新：

```text
324222f Accept proven regenerator cycles and unrelated drivers
727a81f Lower async regenerator prefix and abrupt control
942e483 Treat read-only factory instance observations as closed
2b864ac Snapshot truthiness-observed HTTP responses
ac5b1da Cover missing-global fallback read/write boundaries
38bad28 Restore terminal return Promise proofs
bc84afc Ignore later table rebinds in synchronous probes
3699dd0 Document remaining host-dependent scripts
```

`38bad28` 的父提交是 `ac5b1da`，不是 `727a81f`。因此 `727a81f..38bad28`
之间的净变化包含三个中间提交；核对“38 是否恢复 727 的回退”时必须把三个
`fqzm` key 单独拿出来看，不能直接用 38 相对 727 的总增量代替。

## 全量计数

| 提交 | 成功组合 | 失败组合 | 成功 URL | 相对 324222f |
| --- | ---: | ---: | ---: | --- |
| `324222f` | 282/327 | 45 | 94/109 | 基线 |
| `727a81f` | 279/327 | 48 | 93/109 | 回退 3、新增 0 |
| `38bad28` | 285/327 | 42 | 95/109 | 回退 0、新增 3 |
| `3699dd0`（当前 main） | 285/327 | 42 | 95/109 | 与 38 相同 |

`38bad28` 相对 `727a81f` 的 6 个新增 key 拆分为：

- 3 个 `fqzm` 恢复：qx、surge、loon。
- 3 个 `AppraveTask` 新增：qx、surge、loon。逐提交重跑表明 qx 在
  `942e483` 已成功，surge/loon 在 `2b864ac` 已成功；这三个 key 不应记作
  `38bad28` 的恢复效果。

## `727a81f` 回退完整清单

| URL | 格式 | `324222f` | `727a81f` | `ac5b1da` | `38bad28` |
| --- | --- | --- | --- | --- | --- |
| `https://raw.githubusercontent.com/ios151/Rewrite/main/fqzm.js` | qx | 成功，无错误 | 失败：`结构化原生转换第 13 行：完成函数传给未知回调，无法短路调用者` | 同一错误 | 成功，无错误 |
| 同上 | surge | 成功，无错误 | 同一错误 | 同一错误 | 成功，无错误 |
| 同上 | loon | 成功，无错误 | 同一错误 | 同一错误 | 成功，无错误 |

除这三个 key 外，`324222f → 727a81f` 没有其他成功变失败，也没有成功状态下的
错误文本变化。

## 恢复方式核对

### 状态核验

- `324222f` 成功集合：282 个 key。
- `727a81f` 成功集合：279 个 key。
- `38bad28` 成功集合：285 个 key。
- `324222f → 38bad28`：**回退 0、新增 3**（`AppraveTask` 三格式）。
- `727a81f → 38bad28`：**回退 0、新增 6**（其中 3 个是 `fqzm` 恢复）。
- `324222f → 38bad28` 没有“状态仍为成功但错误文本变化”的 key。

因此没有发现任何 `727a81f` 回退被“悄悄”留在失败状态；也没有发现
`38bad28` 为了恢复 `fqzm` 而把其他已成功 key 压回失败。

### 输出字节核验

对三个恢复 key 使用与普查相同的输入和选项重新运行，比较完整输出正文：

| 格式 | `324222f` 输出 SHA-256 | `38bad28` 输出 SHA-256 | 字节数 | 一致 |
| --- | --- | --- | ---: | --- |
| qx | `89c9c42b6bae3a6df0fd75c9ad04030ae5cf8752c9f7d7a85b536bc530356443` | `89c9c42b6bae3a6df0fd75c9ad04030ae5cf8752c9f7d7a85b536bc530356443` | 45177 | 是 |
| surge | `3cb15aa80413fba90cd9446e369f645eab0b9c3b008562c3ff9a2a76e97e5ebd` | `3cb15aa80413fba90cd9446e369f645eab0b9c3b008562c3ff9a2a76e97e5ebd` | 45232 | 是 |
| loon | `958662c7f045417464c9a4cb3bd7fc7631c942c7a333a752e10355dec8bc65b9` | `958662c7f045417464c9a4cb3bd7fc7631c942c7a333a752e10355dec8bc65b9` | 45229 | 是 |

这比“status 都是成功”更强：恢复后的转换正文与原成功路径逐字节一致，不存在
同一 key 以不同输出形态恢复的问题。

## 机制分析：`727a81f` 为什么回退

`324222f` 的 Promise 证明要求函数最后一条语句是 `return`，并且该函数所有
`return` 参数都可证明为 Promise-like：

```text
terminal statement is ReturnStatement
and every ReturnStatement of the owner is promise-like
```

`727a81f` 把它收窄成“函数体只有一个语句，且该语句是 `return`”：

```text
statements.length === 1
and statements[0] is ReturnStatement
and its argument is promise-like
```

`fqzm` 的形态是：

```js
function later(...) {
  var ...;                 // 终端 return 前的局部初始化
  return new Promise(...); // 终端 return
}
```

在 `727a81f` 下，这个函数不再被证明为 Promise 返回，异步状态机因此没有进入
后续 lowering；最终结构化转换在第 13 行报“完成函数传给未知回调，无法短路
调用者”。这是 Promise 证明失败后的下游错误，不是 `fqzm` 源码本身新增了
回调形状。

## 机制分析：`38bad28` 的保护条件

`38bad28` 恢复为：

```text
last statement is ReturnStatement
and every ReturnStatement of the owner is promise-like
```

与前驱相比，它额外允许 `return` 之前的局部初始化，并为参数/局部绑定带入
`environment`。它没有放宽“所有 return 都必须是 Promise”这一必要条件：

- 缺少终端 `return`：仍拒绝。
- 混入非 Promise 的 `return`：仍拒绝。
- 单条 `return` 的闭合函数/对象方法：仍按 `727a81f` 的 `functionAt` 路径证明。
- `727a81f` 新增的异步前缀求值、`abrupt continue/break`、零/一条有序 catch
  边：代码与测试均保留。

因此它不是用一个新的“保护条件”压住 `727a81f` 的能力，而是把它收窄过头的
单语句条件恢复成 `324222f` 已有的终端返回判据。相对 `324222f`，`38bad28`
没有新增更窄的限制；相对 `727a81f`，它只是重新接受“终端返回前有局部初始化”
这一本来合法的形态。

## 测试核验

在 `38bad28` 上运行：

```sh
.local/round38-venv/bin/python -m unittest tests.test_async_regenerator_lowering -v
```

结果：**10 tests，OK**。覆盖包括：

- `727a81f` 新增的异步前缀副作用/未知调用边界。
- `abrupt continue/break` 与非法目标反例。
- 零条或一条有序 catch 边。
- 闭合函数和对象方法 Promise 转发。
- `38bad28` 新增的“终端 return 前有局部初始化”正例。
- `38bad28` 新增的“缺少终端 return”和“混入非 Promise return”反例。

没有发现 `38bad28` 让 `727a81f` 的合法证明能力回退。

## 最终判定

1. `727a81f` 的完整回退集合是 `fqzm` qx/surge/loon 三个 key。
2. `38bad28` 恢复了全部三个回退；没有部分恢复或静默残留。
3. 恢复不是“换路通过”：三个 key 的输出正文与 `324222f` 逐字节相同。
4. `38bad28` 的终端返回保护不限制 `727a81f` 原本想解的合法能力；它只是把
   `727a81f` 过度收窄的单语句条件恢复到更宽的、仍然可靠的终端返回判据。
