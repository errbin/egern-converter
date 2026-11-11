# 单元 3：完成转发器表的死分支逃逸

## 能力与通用判据

- 目标：闭合字面量表作为整体只在可证死分支中出现时，不再把该引用误判为会
  改写转发器属性的活逃逸。
- 判据：分支条件只能由字面量、不可写局部字面量属性和静态比较求出；活分支、
  未知条件、表成员写入/更新/删除、动态键或其它整体传递仍拒绝。
- 递归保护：条件求值引用同一张表时跳过重复引用扫描，由外层一次完整校验，
  避免死分支证明自我递归。

## 改动

- `tools/js-analysis/transforms/specialization.mjs`：完成转发器查表上下文增加
  闭合值、布尔测试和死分支引用判断。
- `tests/test_completion_forwarder_chains.py`：新增死分支整体逃逸正例，以及活
  分支、未知条件、条件表被改写三条反例。

## 验证

- `python3 -m unittest tests.test_completion_forwarder_chains -v`：9 项通过。
