"""QX Promise 响应解构与同一请求记录自 url 展开的闭合边界。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL = 'https://example.test/qx-promise-destructuring.js'


def convert(source):
    return convert_script(source, 'Fixture', URL, '', source_format='qx')


def reply_source(pattern='({bodyBytes,headers,...res})', tail='resolve(res)'):
    return f'''(async()=>{{
 const run=()=>new Promise((resolve,reject)=>{{
  const op={{url:'https://api.test/a',method:'GET'}};
  const handle={pattern}=>{{
   res.status ??= res.statusCode;
   {tail};
  }};
  $task.fetch({{url:op,...op}}).then(handle,handle);
 }});
 const res=await run();
 $done({{body:res.status+':'+res.body+':'+new Uint8Array(res.bodyBytes).length+':'+res.headerCount}});
}})();'''


class QXPromiseResponseDestructuringTests(unittest.TestCase):
    def test_response_rest_is_materialized_from_native_snapshot(self):
        # 原生响应只读取一次字节流，再投影为 QX 的 statusCode/body/bodyBytes；
        # 解构后的 rest 仍是普通本地记录，可继续沿用作者的状态规范化。
        source = '''(async()=>{
 const run=()=>new Promise((resolve,reject)=>{
  const op={url:'https://api.test/a',method:'GET'};
  const handle=({bodyBytes,headers,...res})=>{
   res.status ??= res.statusCode;
   res.error || res.status < 200 || res.status > 307
    ? reject(new Error(String(res.error)))
    : resolve({body:res.body,status:res.status,bytes:new Uint8Array(bodyBytes).length,headerCount:Object.keys(headers).length});
  };
  $task.fetch({url:op,...op}).then(handle,handle);
 });
 const res=await run();
 $done({body:res.status+':'+res.body+':'+res.bytes+':'+res.headerCount});
})();'''
        native = convert(source)
        self.assertNotIn('$task', native)
        self.assertIn('typeof response', native)
        fixture = {'name': 'qx response destructuring', 'request': {'url': URL},
                   'http': [{'url': 'https://api.test/a', 'status': 202,
                             'headers': {'X-Test': 'yes'}, 'body': 'ok'}],
                   'expected': {'result': {'body': '202:ok:2:1'}}}
        result = compare(source, native, 'qx', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_unknown_computed_nested_default_or_empty_patterns_are_rejected(self):
        # 字段必须来自已证明的响应白名单，且解构形状要能直接映射到快照。
        cases = [
            ('({bodyBytes,cookies,...res})', 'unknown field'),
            ('({[field]:bodyBytes,...res})', 'computed key'),
            ('({bodyBytes:{length},...res})', 'nested pattern'),
            ('({bodyBytes=undefined,...res})', 'default value'),
            ('({})', 'empty pattern'),
        ]
        for pattern, label in cases:
            with self.subTest(label=label), self.assertRaises(ConversionError):
                convert(reply_source(pattern))

    def test_reused_handler_or_observed_chain_keeps_destructuring_rejected(self):
        # 回调改为 async 快照只能在 Promise 链返回值被丢弃且函数身份封闭时成立。
        cases = [
            '''const handle=({bodyBytes,...res})=>{$done({})};
$task.fetch({url:'https://api.test/a'}).then(handle,handle);handle({});''',
            '''$task.fetch({url:'https://api.test/a'}).then(({bodyBytes,...res})=>$done({bodyBytes}),()=>$done({}));''',
            '''const chain=$task.fetch({url:'https://api.test/a'}).then(({bodyBytes,...res})=>{$done({})},()=>$done({}));''',
            '''return $task.fetch({url:'https://api.test/a'}).then(({bodyBytes,...res})=>{$done({})},()=>$done({}));''',
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert(source)

    def test_self_url_spread_requires_same_closed_request_record(self):
        # 只覆盖 `{url: op, ...op}`：前面的 url 必须无副作用且会被后面的展开覆盖。
        accepted = '''(async()=>{
 const op={url:'https://api.test/a',method:'GET'};
 const res=await $task.fetch({url:op,...op});
 $done({body:res.body});
})();'''
        self.assertNotIn('$task', convert(accepted))

        rejected = [
            '''const op={url:'https://api.test/a'};const other={url:'https://api.test/b'};
$task.fetch({url:other,...op}).then(({body})=>{$done({body})},()=>$done({}));''',
            '''const op={url:'https://api.test/a'};
$task.fetch({...op,url:'https://api.test/b'}).then(({body})=>{$done({body})},()=>$done({}));''',
            '''const op={url:'https://api.test/a'};
$task.fetch({method:op,...op}).then(({body})=>{$done({body})},()=>$done({}));''',
            '''const op={method:'GET'};
$task.fetch({url:op,...op}).then(({body})=>{$done({body})},()=>$done({}));''',
        ]
        for source in rejected:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert(source)


if __name__ == '__main__':
    unittest.main()
