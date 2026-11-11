"""异步 regenerator 状态机只有在 Promise 挂起、异常边和完成路径都可证时才降级。"""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'tests/helpers/async-regenerator-lowering.mjs'
URL = 'https://example.test/async-regenerator.js'

SOURCE = '''const runtime=(function(){
 function wrap(inner,outer,self,tryLocsList){
  var context={prev:0,next:0,sent:undefined,method:'next',arg:undefined,tryEntries:tryLocsList||[]};
  context.abrupt=function(type,arg){context.method=type;return {type:type,arg:arg,done:true};};
  context.stop=function(){return {done:true};};
  context.catch=function(){return this.t0;};
  function resume(value){
   context.sent=value;
   var result=inner(context);
   if(result&&typeof result.then==='function')return result.then(resume,resume);
   return result;
  }
  return {next(value){return resume(value);}};
 }
 return {mark:function(fn){return fn;},wrap:wrap,abrupt(type,arg){return {type,arg};},stop(){return {done:true};},_invoke(){return this.prev;}};
})();
function low(){return Promise.resolve('ok')}
(function(){
 var f;
 (f=runtime.mark(function machine(){return runtime.wrap(function(ctx){for(;;)switch(ctx.prev=ctx.next){
 case 0:return (ctx.prev=0,ctx.next=3,low());
 case 3:if(ctx.sent==='ok'){ctx.next=9;break;}return ctx.abrupt('return',$done({body:'bad'}));
 case 9:$done({body:ctx.sent});ctx.next=19;break;
 case 16:ctx.t0=ctx.catch(0);$done({body:'caught'});ctx.next=19;break;
 case 19:case 'end':return ctx.stop();
 }},machine,null,[[0,16]]);}),function(){var drive=f.apply(this,arguments);drive.next();})();
})();'''


def lower(source):
    result = subprocess.run(['node', str(PROBE)], input=source, cwd=ROOT,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class AsyncRegeneratorLoweringTests(unittest.TestCase):
    def assert_not_released(self, source, reason):
        lowered = lower(source)
        self.assertEqual(lowered['transformations'], [], lowered)
        self.assertTrue(lowered['released'], lowered)
        self.assertFalse(lowered['released'][0]['released'], lowered)
        self.assertIn(reason, lowered['released'][0]['reason'], lowered)

    def test_proved_async_machine_lowers_and_preserves_completion(self):
        lowered = lower(SOURCE)
        self.assertEqual(len(lowered['transformations']), 1, lowered)
        self.assertTrue(lowered['released'][0]['released'], lowered)
        self.assertIn('ctx.sent = await', lowered['source'])
        output = convert_script(SOURCE, 'Fixture', URL, '', source_format='surge')
        fixture = {'name': 'async regenerator', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(SOURCE, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_async_prefix_effects_terminal_tail_and_saved_error_observation(self):
        prefix = SOURCE.replace(
            '(ctx.prev=0,ctx.next=3,low())',
            "(console.log('start'),marker='go',ctx.prev=0,ctx.next=3,low())",
        )
        lowered = lower(prefix)
        self.assertEqual(len(lowered['transformations']), 1, lowered)
        self.assertIn("console.log('start');", lowered['source'])
        self.assertIn("marker='go';", lowered['source'])
        self.assertIn('ctx.next = 3;', lowered['source'])
        self.assertIn('ctx.sent = await', lowered['source'])

        terminal = lower(SOURCE.replace(
            "return ctx.abrupt('return',$done({body:'bad'}));",
            "return (console.log('stop'),$done({body:'bad'}),ctx.abrupt('return'));",
        ))
        self.assertEqual(len(terminal['transformations']), 1, terminal)
        self.assertIn("console.log('stop')", terminal['source'])

        observed = SOURCE.replace(
            "case 16:ctx.t0=ctx.catch(0);$done({body:'caught'});",
            "case 16:ctx.t0=ctx.catch(0);console.log(ctx.t0);$done({body:'caught'});",
        )
        lowered = lower(observed)
        self.assertEqual(len(lowered['transformations']), 1, lowered)
        self.assertIn('console.log(ctx.t0);', lowered['source'])
        output = convert_script(observed, 'Fixture', URL, '', source_format='surge')
        fixture = {'name': 'async regenerator observed catch', 'request': {'url': URL},
                   'expected': {'result': {'body': 'ok'}}}
        result = compare(observed, output, 'surge', URL, fixture)
        self.assertEqual(result['status'], 'passed', result)

    def test_async_prefix_context_writes_unknown_calls_and_cross_case_t0_are_rejected(self):
        for source, reason in [
            (SOURCE.replace('(ctx.prev=0,ctx.next=3,low())',
                            "(console.log('start'),unknown(),ctx.prev=0,ctx.next=3,low())"),
             '异步挂起返回含未知前置表达式'),
            (SOURCE.replace('(ctx.prev=0,ctx.next=3,low())',
                            "(ctx.sent='bad',ctx.prev=0,ctx.next=3,low())"),
             '异步挂起返回含未知前置表达式'),
            (SOURCE.replace("case 16:ctx.t0=ctx.catch(0);$done({body:'caught'});",
                            "case 16:ctx.t0=ctx.catch(0);$done({body:'caught'});"
                            "case 17:console.log(ctx.t0);ctx.next=19;break;"),
             '异步状态机 t0 读取必须位于同一保存处理区域'),
        ]:
            with self.subTest(source=source):
                self.assert_not_released(source, reason)

    def test_non_promise_suspension_is_not_released(self):
        self.assert_not_released(SOURCE.replace('(ctx.prev=0,ctx.next=3,low())',
                                                '(ctx.prev=0,ctx.next=3,42)'),
                                 '异步挂起返回不是本地可证明的 Promise 调用')

    def test_handler_side_effect_and_multiple_completions_remain_rejected(self):
        for source, reason in [
            (SOURCE.replace("case 16:ctx.t0=ctx.catch(0);",
                            "case 16:ctx.t0=ctx.catch(0);$persistentStore.write('late','key');"),
             '异步状态机异常处理区域含业务调用'),
            (SOURCE.replace("case 16:ctx.t0=ctx.catch(0);$done({body:'caught'});",
                            "case 16:ctx.t0=ctx.catch(0);$done({body:'caught'});$done({body:'again'});"),
             '异步状态机异常处理区域包含多个完成调用'),
        ]:
            with self.subTest(source=source):
                self.assert_not_released(source, reason)

    def test_catch_slot_and_generator_escape_must_be_static(self):
        for source, reason in [
            (SOURCE.replace('ctx.catch(0)', 'ctx.catch(1)'), '异步状态机 catch 保存点不可证明'),
            (SOURCE.replace('ctx.t0=ctx.catch(0);', 'const saved=ctx.t0;ctx.t0=ctx.catch(0);'),
             '异步状态机 t0 只允许由 catch 保存点赋值'),
            (SOURCE.replace('drive.next();})();', 'drive.next();})();unknown(f);'),
             '异步状态机生成器对象在驱动外逃逸'),
            (SOURCE.replace('drive.next();})();', 'drive.next();})();f=null;'),
             '异步状态机生成器对象在驱动外被重新赋值'),
        ]:
            with self.subTest(source=source):
                self.assert_not_released(source, reason)

    def test_unreleased_machine_does_not_enter_conversion(self):
        for source in [
            SOURCE.replace('(ctx.prev=0,ctx.next=3,low())', '(ctx.prev=0,ctx.next=3,42)'),
            SOURCE.replace("case 16:ctx.t0=ctx.catch(0);",
                           "case 16:ctx.t0=ctx.catch(0);$persistentStore.write('late','key');"),
            SOURCE.replace('ctx.catch(0)', 'ctx.catch(1)'),
        ]:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='surge')


if __name__ == '__main__':
    unittest.main()
