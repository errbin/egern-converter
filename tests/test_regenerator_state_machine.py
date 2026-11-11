"""regenerator 状态机只放行极简同步 .wrap 机器，其余形状继续拒绝。"""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub import js_analysis


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'tests/helpers/state-machine-proof.mjs'
URL = 'https://example.test/regenerator-state-machine.js'

RUNTIME = '''const runtime=(function(){
 function mark(fn){return fn}
 function wrap(inner,outer,self,tryLocsList){
  var context={prev:0,next:0,sent:undefined,method:'next',arg:undefined,tryEntries:tryLocsList||[]};
  function abrupt(type,arg){context.method=type;return {type,arg}}
  function stop(){return {done:true}}
  function _invoke(method,arg){context.method=method;context.arg=arg;return inner(context)}
  return {next(value){var result=_invoke('next',value);return {value:result,done:false}}}
 }
 return {mark,wrap,abrupt,stop,_invoke(){return this.prev}};
})();
'''


def source_with(body, tail='const drive=outer();drive.next();', table=''):
    return (RUNTIME +
            f"function outer(){{return runtime.wrap(function(ctx){{for(;;)switch(ctx.prev=ctx.next){{{body}}}}},outer,null{',' + table if table else ''});}}\n"
            + tail + '\n')


def prove(source):
    result = subprocess.run(['node', str(PROBE)], input=source, cwd=ROOT,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class RegeneratorStateMachineTests(unittest.TestCase):
    def assert_rejected_shape(self, source, gap):
        proof = prove(source)
        self.assertTrue(proof['detected'], proof)
        self.assertFalse(proof['proved'], proof)
        self.assertTrue(any(gap in item for item in proof['gaps']), proof)
        self.assertFalse(proof['release'], proof)

    def test_closed_linear_graph_enumerates_states_edges_and_slots(self):
        proof = prove(source_with("case 0:ctx.next=2;break;case 2:return ctx.stop();"))
        self.assertTrue(proof['proved'], proof)
        self.assertFalse(proof['release'], proof)
        machine = proof['machines'][0]
        self.assertEqual([node['state'] for node in machine['nodes'] if node['kind'] == 'restore'], [0, 2])
        self.assertIn('state:0', {edge['from'] for edge in machine['edges']})
        self.assertTrue(any(slot['name'] == 'ctx.next' and slot['writes'] for slot in machine['saveSlots']))
        self.assertEqual(machine['runtime']['externalDrives'], 1)

    def test_external_driver_escape_is_rejected(self):
        source = source_with("case 0:return ctx.stop();", 'const drive=outer();unknown(drive);drive.next();')
        self.assert_rejected_shape(source, 'generator 对象逃逸或被外部驱动')

    def test_reassigned_save_slot_is_rejected(self):
        body = ("case 0:var saved=function(){$done({body:'first'});};"
                "saved=function(){$done({body:'second'});};return ctx.stop();")
        self.assert_rejected_shape(source_with(body), '保存槽 saved 有多个写入点')

    def test_save_slot_escaping_the_closure_is_rejected(self):
        body = ("case 0:var saved=function(){$done({body:'ok'});};"
                "consume(saved);return ctx.stop();")
        self.assert_rejected_shape(source_with(body), '保存槽 saved 逃逸出封闭调用位置')

    def test_multiple_dispatch_entries_are_rejected(self):
        body = ("case 0:for(;;)switch(ctx.prev=ctx.next){case 1:return ctx.stop();}"
                "return ctx.stop();")
        self.assert_rejected_shape(source_with(body), '状态机有 2 个分派入口')

    def test_exception_edge_to_unknown_state_is_rejected(self):
        body = 'case 0:ctx.next=2;break;case 2:return ctx.stop();'
        self.assert_rejected_shape(source_with(body, table='[[0,9]]'), '异常表 catch 目标不在状态图中：9')

    def test_finally_side_effect_is_rejected(self):
        body = ('case 0:ctx.next=2;break;case 2:ctx.next=4;break;'
                'case 4:$persistentStore.write("late","effect");ctx.next=6;break;'
                'case 6:return ctx.stop();')
        self.assert_rejected_shape(source_with(body, table='[[0,4,4,6]]'), 'finally 区域含可观察副作用：状态 4')

    def test_unknown_finally_call_is_rejected(self):
        body = ('case 0:ctx.next=2;break;case 2:ctx.next=4;break;'
                'case 4:mutate();ctx.next=6;break;case 6:return ctx.stop();')
        self.assert_rejected_shape(source_with(body, table='[[0,4,4,6]]'), 'finally 区域含可观察副作用：状态 4')

    def test_context_alias_is_rejected(self):
        body = ('case 0:var alias=ctx;alias.next=2;return ctx.stop();'
                'case 2:return ctx.stop();')
        self.assert_rejected_shape(source_with(body), '状态上下文存在别名或未知逃逸')

    def test_unreachable_state_is_rejected(self):
        body = 'case 0:return ctx.stop();case 2:return ctx.stop();'
        self.assert_rejected_shape(source_with(body), '状态从单一入口不可达：2')

    def test_closed_helper_transition_is_included(self):
        body = ('case 0:function helper(){ctx.next=2;}helper();return ctx.stop();'
                'case 2:return ctx.stop();')
        proof = prove(source_with(body))
        self.assertTrue(proof['proved'], proof)
        machine = proof['machines'][0]
        self.assertTrue(any(edge['from'] == 'state:0' and edge['to'] == 'state:2' for edge in machine['edges']), machine)

    def test_minimal_state_machine_can_enter_conversion(self):
        source = source_with("case 0:$done({body:'ok'});return ctx.stop();")
        self.assertTrue(prove(source)['machines'][0]['minimal'])
        output = convert_script(source, 'Fixture', URL, '', source_format='surge')
        self.assertNotIn('runtime.wrap', output)

    def test_exception_table_state_machine_remains_rejected(self):
        source = source_with("case 0:return ctx.stop();", table='[[0,2]]')
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='surge')

    def test_clean_exception_handler_enters_minimal_mode(self):
        body = ("case 0:ctx.prev=0;ctx.next=2;break;"
                "case 2:JSON.parse('{');ctx.next=4;break;"
                "case 4:ctx.next=6;break;"
                "case 6:$done({body:'recovered'});return ctx.stop();")
        machine = prove(source_with(body, table='[[0,4]]'))['machines'][0]
        self.assertTrue(machine['minimal'], machine)
        self.assertEqual([(entry['tryLoc'], entry['catchLoc']) for entry in machine['exceptions']], [(0, 4)], machine)

    def test_exception_handler_business_side_effect_is_rejected(self):
        body = ("case 0:ctx.prev=0;ctx.next=2;break;"
                "case 2:ctx.next=4;break;"
                "case 4:$persistentStore.write('late','effect');ctx.next=6;break;"
                "case 6:$done({body:'x'});return ctx.stop();")
        machine = prove(source_with(body, table='[[0,4]]'))['machines'][0]
        self.assertFalse(machine['minimal'], machine)
        self.assertTrue(any('异常处理区域含业务副作用' in gap for gap in machine['minimalGaps']), machine)

    def test_exception_handler_target_unreachable_is_rejected(self):
        body = ("case 0:return ctx.stop();"
                "case 2:ctx.prev=2;ctx.next=4;break;"
                "case 4:$done({body:'x'});return ctx.stop();")
        proof = prove(source_with(body, table='[[2,4]]'))
        self.assertFalse(proof['proved'], proof)
        self.assertTrue(any('异常处理目标状态不可达' in gap for gap in proof['machines'][0]['minimalGaps']), proof)

    def test_exception_table_state_count_mismatch_is_rejected(self):
        body = ("case 0:ctx.prev=0;ctx.next=2;break;"
                "case 2:$done({body:'x'});return ctx.stop();")
        proof = prove(source_with(body, table='[[0,2],[0,2],[0,2]]'))
        self.assertFalse(proof['proved'], proof)
        self.assertTrue(any('异常表条目数与状态数不一致' in gap for gap in proof['gaps']), proof)

    def test_native_option_exposes_stage_one_summary_without_release(self):
        source = source_with('case 0:return ctx.stop();')
        report = js_analysis.analyze_many(
            [(source, 'surge', json.dumps({'state_machine_proof': True, 'allowNoCompletion': True}))],
            mode='native',
        )[0]
        self.assertEqual(report['state_machine']['detected'], 1, report)
        self.assertFalse(report['state_machine']['release'], report)


if __name__ == '__main__':
    unittest.main()
