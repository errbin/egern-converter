# 单元 5：恒等包装谓词表的死分支逃逸

## 能力与通用判据

- 目标：闭合字面量表作为整体只出现在可证死分支时，不再误判为会改写恒等包装
  所依赖的静态属性。
- 判据：分支条件只能由字面量、不可写局部字面量属性及静态相等比较求出；活分支、
  未知条件、表成员写入/更新/删除、动态键或其它整体传递仍拒绝。
- 安全边界：成员改写无条件拒绝，即使位于死分支；递归校验同一张表时跳过重复扫描，
  由外层完成一次完整引用检查。

## 改动

- `tools/js-analysis/compiler/flow.mjs`：闭合表整体引用增加死分支判断；布尔条件
  求值改用闭合值而非仅属性读取，从而支持 `flags.enabled===false` 这类字面量比较。
- `tests/test_completion_forwarder_chains.py`：新增恒等包装谓词表在死分支整体逃逸
  的正例，以及活分支、未知条件、成员改写三条反例。

## 反例覆盖

- 活分支 `if(flags.enabled===true)unknown(flags)`：拒绝恒等包装证明。
- 未知条件 `if($argument==='dead')unknown(flags)`：拒绝恒等包装证明。
- 谓词表成员写入 `flags.enabled=false`：即使后续逃逸位于静态死分支，仍拒绝。

## 验证

- `python3 -m unittest tests.test_completion_forwarder_chains -v`：11 项通过。
- 正例的包装 else 分支返回非恒等函数，证明成功仅依赖死分支引用判断；若去掉该
  判断会因无法求值条件而保守失败。
