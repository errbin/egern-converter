# 单元 6：条件方法别名经闭合转发器派发

## 能力与通用判据

- 目标：`$httpClient` 条件方法选择可经只做一次原序转交的三参转发器派发，同时保留
  条件表达式的一次求值顺序与动态方法守卫。
- 方法别名判据：别名初值必须是 `$httpClient` 静态方法组成的条件/短路选择；所有引用
  只能是直接 HTTP 调用，或作为闭合转发器首参交给转发器。复制、重绑、比较、动态键、
  表属性改写或交给未知代码都拒绝。
- 转发器判据：函数体只能是一条 `return 方法(请求, 回调)`；参数不得重绑，实参顺序
  必须严格对应，表属性必须唯一且不可写，表整体引用只能出现在可证死分支。
- 请求字段判据：未知函数只接收能证明恒为 `undefined` 的字段值；直接缺席的参数字段，
  以及由这种字段静态装配的局部记录字段，才可通过该证明。其余字段值仍按白名单拒绝。

## 改动

- `tools/js-analysis/compiler/native.mjs`：增加条件方法选择、闭合三参转发器、统一
  HTTP 派发识别、转发请求/回调投影、调用点前字段装配吸收，以及缺席字段值逃逸证明。
- `tests/test_conditional_http_dispatch.py`：新增条件方法经闭合转发器的 GET/POST
  正例，以及未知分支、别名复制/重绑、方法逃逸、转发器改写、额外语句和参数错序反例。
- `tests/test_http_request_assembly.py`：新增缺席字段可观察正例，以及条件调用实参、
  未知调用实参两条拒绝反例。

## 验证

- `python3 -m unittest tests.test_conditional_http_dispatch -v`：6 项通过。
- `python3 -m unittest tests.test_http_request_assembly -v`：4 项通过。
- 相关四套件共 25 项，24 项通过；唯一失败
  `test_escaped_method_and_unknown_stored_request_are_rejected` 在干净基线 HEAD 上同样失败。
- 真实 `kugouv5.js` 用 `convert_script` 后 compare：Surge `passed`、Loon `passed`、QX
  `passed`。请求 URL 为
  `https://kg.zzxu.de/api/v5url?hash=abc&mode=raw&quality=high&fallback=0&debug=0&album_id=&album_audio_id=`，
  响应 `{"code":0,"data":"ok"}`。

## E2E 状态

- 预期：`kugouv5.js` 三格式新增 3 个成功组合、1 个成功 URL；最终以批次结果为准。
- 基线：59/109 URL、175/327 组合。
