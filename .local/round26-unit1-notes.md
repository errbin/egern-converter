# 单元 1：QX 动态请求缺省 timeout 省略

## 能力与通用判据

- 目标：QX 源请求未设置 `timeout` 时，转换结果不物化平台缺省 `5000`；显式值仍按毫秒转发。
- 判据：`undefined` 等价于平台缺省，字段省略与写出缺省值语义相同；`null`、`0` 等非
  `undefined` 值不得误删。
- 范围：只改 QX 动态/运行期请求路径；非 QX 动态请求的既有缺省行为保持不变。

## 改动

- `tools/js-analysis/compiler/native.mjs`：QX 动态请求选项由固定 `timeout: ... ? 5000 : ...`
  改为条件展开，仅在运行期值非 `undefined` 时输出 `request.timeout`。
- `tests/test_native_convert.py`：新增动态请求三例（缺省、字面量显式、运行期写入显式），
  并断言非 QX 回调动态请求仍输出 `timeout:5000`。

## 反例覆盖

- 显式字面量 `timeout:15000`：输出并观测到 15000。
- 运行期写入 `request.timeout=15000`：输出并观测到 15000。
- 非 QX 来源：动态回调请求仍输出 `timeout:5000`，证明没有扩大省略范围。

## 验证

- 定向测试 4 项通过：
  - `test_qx_dynamic_request_omits_absent_timeout_and_keeps_explicit_values`
  - `test_qx_task_fetch_timeout_passes_through_in_milliseconds`
  - `test_qx_promise_chain_success_error_and_native_completion`
  - `test_qx_static_task_fetch_timeout_is_milliseconds`
- 真实 `fqzm.js` 用 `convert_script` 后 compare：Surge `passed`、Loon `passed`、QX `passed`。
  修复前 QX 唯一差异为 `$.events.requests[0].timeout`。

## E2E 状态

- 预期：`fqzm.js` QX 组合新增 1 个成功组合、1 个成功 URL；最终以批次结果为准。
- 基线：59/109 URL、175/327 组合；尚未跑本轮最终全量批次。
