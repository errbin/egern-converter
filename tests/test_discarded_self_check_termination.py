"""丢弃式源码自检的回调必须短路，否则产物无法证明终止。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import execute

URL = 'https://example.test/self-check-termination.js'

SHELL = '''var factory=(function(){
 var table={};
 table["pattern"]="(((.+)+)+)+$",table["label"]="ready";
 var alias=table;
 return function(c,d){
  var wrapper=function(){
   if(d){
    var result=d.apply(c,arguments);
    return d=null,result;
   }
  };
  return wrapper;
 };
})();
var wrapper=factory(this,function(){
 var table={};
 table["pattern"]="(((.+)+)+)+$";
 var alias=table;
 return wrapper.toString().search(alias["pattern"]).toString().constructor(wrapper).search(alias["pattern"]);
});
'''


MULTI_PATH = '''var factory=(function(){
 var state=true;
 return function(host,callback){
  var fn=state?function(){
   if(host){
    var first=callback.apply(host,arguments);
    return callback=null,first;
   }else{
    if(callback){
     var second=callback.apply(host,arguments);
     return callback=null,second;
    }
    return callback=null,undefined;
   }
  }:function(){};
  return state=false,fn;
 };
})();
var wrapper=factory(this,function(){
 var table={};
 table["pattern"]="(((.+)+)+)+$";
 var alias=table;
 return wrapper.toString().search(alias["pattern"]).toString().constructor(wrapper).search(alias["pattern"]);
});
'''


LAUNCHER_SELECTOR = '''var table={
 "call":function(factory,host,callback){return factory(host,callback);},
 "discard":function(fn){return fn();}
};
var factory=(function(){
 var state=true;
 return function(host,callback){
  var chosen=state?function(){
   if(callback){
    var result=callback.apply(host,arguments);
    return callback=null,result;
   }
   return callback=null,undefined;
  }:function(){};
  return state=false,chosen;
 };
}());
var wrapper=table["call"](factory,this,function(){
 return wrapper.toString().search("(((.+)+)+)+$").toString().constructor(wrapper).search("(((.+)+)+)+$");
});
table["discard"](wrapper);
'''


class DiscardedSelfCheckTerminationTests(unittest.TestCase):
    def convert(self, source):
        return convert_script(source, 'Fixture', URL, '', source_format='surge')

    def test_table_population_self_check_is_short_circuited(self):
        source = SHELL + '(wrapper());\n$done({body:"ok"});\n'
        native = self.convert(source)
        self.assertNotIn('search', native)
        result = execute(native, 'surge', URL,
                         {'name': 'self check', 'request': {'url': URL},
                          'response': {'status': 200, 'headers': {}, 'body': 'ok'}},
                         'converted')
        self.assertNotIn('error', result, result)
        self.assertEqual(result['observation']['result'], {'body': 'ok'})

    def test_observable_self_check_result_is_rejected(self):
        # 包装调用结果被业务读取时不能短路回调；自检正则随格式化可能灾难性
        # 回溯，产物无法证明终止，必须在生成前拒绝。
        source = SHELL + ('var kept=wrapper();\n'
                          '$done({body:kept===undefined?"ok":String(kept)});\n')
        with self.assertRaisesRegex(ConversionError, '无法证明终止'):
            self.convert(source)

    def test_multiple_mutually_exclusive_apply_paths_are_short_circuited(self):
        # 混淆器会把自检回调的调用拆成多条互斥 apply 路径，每条路径都重置
        # 回调槽位；只要所有写入都是 null 重置、所有调用结果都随即返回且
        # 包装调用被丢弃，短路回调体仍然安全并可证明终止。
        source = MULTI_PATH + '(wrapper());\n$done({body:"ok"});\n'
        native = self.convert(source)
        self.assertNotIn('search', native)
        result = execute(native, 'surge', URL,
                         {'name': 'multi path self check', 'request': {'url': URL},
                          'response': {'status': 200, 'headers': {}, 'body': 'ok'}},
                         'converted')
        self.assertNotIn('error', result, result)
        self.assertEqual(result['observation']['result'], {'body': 'ok'})

    def test_table_launcher_and_selected_wrapper_are_short_circuited(self):
        source = LAUNCHER_SELECTOR + '$done({body:"ok"});\n'
        native = self.convert(source)
        self.assertNotIn('search', native)
        result = execute(native, 'surge', URL,
                         {'name': 'launcher selector self check', 'request': {'url': URL},
                          'response': {'status': 200, 'headers': {}, 'body': 'ok'}},
                         'converted')
        self.assertNotIn('error', result, result)
        self.assertEqual(result['observation']['result'], {'body': 'ok'})

    def test_observable_launcher_result_or_ambiguous_state_is_rejected(self):
        # 两个反例分别破坏“调用结果丢弃”和“状态选择确定”两项前提；自检
        # 回调仍留在产物中时无法证明终止，必须在生成前拒绝。
        counterexamples = [
            LAUNCHER_SELECTOR.replace(
                'table["discard"](wrapper);',
                'var kept=table["discard"](wrapper);$done({body:String(kept)});'),
            LAUNCHER_SELECTOR.replace('var state=true;', 'var state=false;'),
        ]
        for source in counterexamples:
            with self.subTest(source=source), self.assertRaisesRegex(ConversionError, '无法证明终止'):
                self.convert(source)

    def test_non_null_callback_write_is_rejected(self):
        source = (MULTI_PATH.replace('return callback=null,undefined;',
                                     'return callback=callback,undefined;')
                  + '(wrapper());\n$done({body:"ok"});\n')
        with self.assertRaisesRegex(ConversionError, '无法证明终止'):
            self.convert(source)


if __name__ == '__main__':
    unittest.main()
