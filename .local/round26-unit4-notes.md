# 单元 4：异步状态机前缀副作用与保存值观察

## 能力与通用判据

- 目标：异步 regenerator 降级时保留挂起返回前的普通赋值和日志观察；终止返回
  只要求序列尾部是 `stop`、`abrupt` 或 `catch`，前缀按原文保序执行。
- 状态安全：非终止前缀不得读取或写入状态上下文；普通赋值必须整体不涉及
  `prev/next/sent/t0`，否则拒绝。
- 日志安全：只接受 `$log`，或全局 `console` 未被重绑定、整体逃逸、动态读取时
  的直接日志方法调用。
- `t0` 安全：只允许在 `catch` 保存点之后、同一 `SwitchCase` 处理区域内读取；
  跨 case 或保存前读取拒绝。异常处理区的日志及日志参数中的 `t0` 观察保序保留。

## 改动

- `tools/js-analysis/transforms/specialization.mjs`：引入 AST 子节点遍历，增加
  上下文引用判断、闭合日志观察、终止序列尾部识别、普通赋值前缀和同区 `t0` 读取。
- `tests/test_async_regenerator_lowering.py`：新增前缀赋值/日志、终止尾部、
  handler 内 `t0` 日志正例，以及未知调用、`ctx.sent` 写入、跨 case 读取三条反例。

## 验证

- `python3 -m unittest tests.test_async_regenerator_lowering -v`：7 项通过。
