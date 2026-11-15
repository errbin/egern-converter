"""jsjiami v5 表只按闭合结构解码，并删除已审查的反调试自检脚手架。"""
import base64
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script

ROOT = Path(__file__).resolve().parents[1]
FOLD = ROOT / 'tests/helpers/v5-fold.mjs'
DECODER = (ROOT / 'tests/helpers/v5-decoder-family.js').read_text().split('\n', 1)[1].strip()
URL = 'https://example.test/v5.js'


def rc4(text, key):
    box = list(range(256))
    index = 0
    for position in range(256):
        index = (index + box[position] + ord(key[position % len(key)])) % 256
        box[position], box[index] = box[index], box[position]
    index = cursor = 0
    output = []
    for character in text:
        index = (index + 1) % 256
        cursor = (cursor + box[index]) % 256
        box[index], box[cursor] = box[cursor], box[index]
        output.append(chr(ord(character) ^ box[(box[index] + box[cursor]) % 256]))
    return ''.join(output)


def encrypted(text, key='k'):
    return base64.b64encode(rc4(text, key).encode()).decode()


ROTATION = '''(function(T,n){
 var shift=function(c){while(--c){T['push'](T['shift']());}};
 var holder=function(){
  var api={
   'removeCookie':function(){return'dev';},
   'getCookie':function(fn,c){var step=function(f,c){f(++c);};step(shift,n);return f;}
  };
  var check=function(){var re=new RegExp('\\\\w+ *\\\\(\\\\) *{\\\\w+ *[\\'|"].+[\\'|"];? *}');return re['test'](api['removeCookie']['toString']());};
  api['updateCookie']=check;
  var state=api['updateCookie']();
  if(!state){throw Error('unreachable');}
  else if(state){api['getCookie'](null,'counter');}
  return state;
 };
 holder();
})(__0x11cd0a,0x1);'''

SHELL = '''(function(w){
 var q={'v':'jsjiami.com.v5','msg':'删除版本号，js会定期弹窗','ne':function(a,b){return a!==b;}};
 if(q['ne']('a','b')){w['console']={};}else{$done({body:'bad'});}
 var stop=function(){while(!![]){};};
})(window);'''

TIMER = '''setInterval(function(){
 var box={'call':function(f){return f();}};
 box['call'](_0x5cd97e);
},0xfa0);
function _0x5cd97e(){
 if(typeof $request!=='undefined'){$done({body:'bad'});}
 debugger;
 return _0x5cd97e;
}'''


def fixture():
    table = [encrypted('unused0'), encrypted('ok'), encrypted('unused2'), encrypted('unused3')]
    values = ','.join(json.dumps(value) for value in table)
    return (
        "var encode_version='jsjiami.com.v5',ikltk='__0x11cd0a',__0x11cd0a=[%s];\n%s\n"
        "var _0x38d3=%s;\n$done({body:_0x38d3('0x0','k')});\n%s\n%s\n"
        "encode_version='jsjiami.com.v5';\n" % (values, ROTATION, DECODER, TIMER, SHELL)
    )


def fold(source):
    result = subprocess.run(['node', str(FOLD)], input=source, cwd=ROOT,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class V5StringTableTests(unittest.TestCase):

    def test_reviewed_family_decodes_and_removes_scaffold(self):
        data = fold(fixture())
        self.assertNotIn('error', data)
        self.assertEqual(data['transformations'][0]['kind'], 'jsjiami-v5-string-table')
        self.assertEqual(data['transformations'][0]['rotation_steps'], 1)
        self.assertIn('$done({body:"ok"});', data['source'])
        for marker in ('window', 'setInterval', 'jsjiami.com.v5', '__0x11cd0a', '_0x38d3'):
            self.assertNotIn(marker, data['source'])
        output = convert_script(fixture(), 'Fixture', URL, '', source_format='surge')
        self.assertIn('body: "ok"', output)
        self.assertNotIn('window', output)

    def test_rotation_structure_or_count_changes_are_rejected(self):
        cases = {
            'post_increment_removed': (ROTATION.replace('f(++c)', 'f(c)'), '轮转 \\+\\+ 转发函数结构不匹配'),
            'wrapper_called_twice': (ROTATION.replace('step(shift,n);', 'step(shift,n);step(shift,n);'), '移位函数存在额外引用'),
            'target_out_of_range': (ROTATION.replace('})(__0x11cd0a,0x1);', '})(__0x11cd0a,0x0);'), '轮转次数超出字符串表边界'),
        }
        for name, (rotation, reason) in cases.items():
            with self.subTest(name=name):
                source = fixture().replace(ROTATION, rotation)
                self.assertNotEqual(source, fixture())
                data = fold(source)
                self.assertIn('error', data)
                self.assertRegex(data['error'], reason)

    def test_table_and_decoder_escape_are_rejected(self):
        cases = {
            'table_alias': (fixture().replace('var _0x38d3=', 'var leaked=__0x11cd0a;\nvar _0x38d3='), '字符串表仍被业务代码读取'),
            'decoder_alias': (fixture().replace('var _0x38d3=', 'var leaked;\nvar _0x38d3=').replace(
                "$done({body:_0x38d3('0x0','k')});", "$done({body:_0x38d3('0x0','k')});leaked=_0x38d3;"), '解码器逃逸或存在动态引用'),
            'dynamic_lookup': (fixture().replace("$done({body:_0x38d3('0x0','k')});",
                                                 "var index='0x0';$done({body:_0x38d3(index,'k')});"), '实参不是双字面量'),
            'decoder_algorithm_changed': (fixture().replace('_0x6b547=_0x6b547-0x0', '_0x6b547=_0x6b547-0x1', 1), '解码器不唯一或缺失'),
        }
        for name, (source, reason) in cases.items():
            with self.subTest(name=name):
                self.assertNotEqual(source, fixture())
                data = fold(source)
                self.assertIn('error', data)
                self.assertRegex(data['error'], reason)

    def test_timer_callback_and_self_check_references_are_closed(self):
        cases = {
            'timer_writes_global': (fixture().replace(TIMER, TIMER.replace(
                'box[\'call\'](_0x5cd97e);', "box['call'](_0x5cd97e);window['x']=1;")), '周期自检回调读取了自由全局：window'),
            'timer_calls_completion': (fixture().replace(TIMER, TIMER.replace(
                'box[\'call\'](_0x5cd97e);', "box['call'](_0x5cd97e);$done({body:'bad'});")), '周期自检回调读取了自由全局：\\$done'),
            'timer_target_used_by_business': (fixture().replace(
                "encode_version='jsjiami.com.v5';\n", "var leaked=_0x5cd97e;\nencode_version='jsjiami.com.v5';\n"), '周期自检函数仍被业务代码引用'),
        }
        for name, (source, reason) in cases.items():
            with self.subTest(name=name):
                self.assertNotEqual(source, fixture())
                data = fold(source)
                self.assertIn('error', data)
                self.assertRegex(data['error'], reason)

    def test_shell_result_discard_and_effects_are_proven(self):
        cases = {
            'shell_result_used': (fixture().replace('(function(w){\n var q=', 'var shell=(function(w){\n var q='), '自检 IIFE 数量不唯一或缺失'),
            'shell_reachable_completion': (fixture().replace(SHELL, SHELL.replace("q['ne']('a','b')", "q['ne']('a','a')")), '自检 IIFE 读取了未审查的自由全局：\\$done'),
            'shell_writes_non_console_global': (fixture().replace(SHELL, SHELL.replace("w['console']={};", "w['console']={};w['x']=1;")), '自检 IIFE 写入了全局非 console 字段'),
            'shell_calls_host_api': (fixture().replace(SHELL, SHELL.replace("w['console']={};", "w['console']={};$notification.post('x','','');")), '未审查的自由全局：\\$notification'),
        }
        for name, (source, reason) in cases.items():
            with self.subTest(name=name):
                self.assertNotEqual(source, fixture())
                data = fold(source)
                self.assertIn('error', data)
                self.assertRegex(data['error'], reason)


if __name__ == '__main__':
    unittest.main()
