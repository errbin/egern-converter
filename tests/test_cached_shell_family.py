"""缓存式解码器内嵌自防御壳必须整族通过结构证明后才能折叠。"""
import base64
import json
import os
from pathlib import Path
import subprocess
import unittest


ROOT=Path(__file__).resolve().parents[1]
FOLD=ROOT/'tests/helpers/cached-shell-fold.mjs'
CORPUS=ROOT/'tests/helpers/cached-shell-corpus.mjs'
ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
VERSION='jsjiami.com.v7'
CIPHER=[base64.b64encode(value.encode()).decode() for value in ('100','200','300')]

BASE=dict(shell='S',external='external',state='state',sample='sample',regexA='regexA',regexB='regexB',check='check',helper='helper',recursive='recursive',param='p',value='v',regex='re',result='result',index='i',length='n',guard='guard')
ALT=dict(shell='Zq',external='bound',state='bag',sample='source',regexA='left',regexB='right',check='verify',helper='short',recursive='again',param='x',value='y',regex='pattern',result='chosen',index='k',length='size',guard='ready')


def shell(decoder,names,mode='valid',argument=None,enabled=True):
    if not enabled:
        return ''
    names=dict(names)
    values="['%s','%s','%s','%s','%s']"%(VERSION,'X'+VERSION,*CIPHER)
    shell_name=names['shell']
    param=names['param']
    value=names['value']
    write=f"{decoder}['touched']=0x1;" if mode=='external_write' else ''
    regex_a=r'\x5cw+' if mode=='regex' else r'\x5cw+ *\x5c(\x5c) *{\x5cw+ *'
    sample_body="\nreturn'changed';" if mode=='sample' else "return'newState';"
    guard=f"Boolean(~{value})" if mode=='bypass' else f"!Boolean(~{value})"
    target=argument or decoder
    call=f"new {shell_name}({target})['{names['check']}']()"
    if mode=='result_used':
        call=f"{decoder}['result']={call}"
    return f"""if({decoder}['{names['guard']}']===undefined){{
var {shell_name}=function({param}){{
this['{names['external']}']={param},this['{names['state']}']=[0x1,0x0,0x0],this['{names['sample']}']=function(){{{sample_body}}},this['{names['regexA']}']='{regex_a}',this['{names['regexB']}']='[\\x27|"].+[\\x27|"];? *}}';
}};
{shell_name}['prototype']['{names['check']}']=function(){{
{write}var {names['regex']}=new RegExp(this['{names['regexA']}']+this['{names['regexB']}']),{names['result']}={names['regex']}['test'](this['{names['sample']}']['toString']())?--this['{names['state']}'][0x1]:--this['{names['state']}'][0x0];
return this['{names['helper']}']({names['result']});
}};
{shell_name}['prototype']['{names['helper']}']=function({value}){{
if({guard})return {value};
return this['{names['recursive']}'](this['{names['external']}']);
}};
{shell_name}['prototype']['{names['recursive']}']=function({value}){{
for(var {names['index']}=0x0,{names['length']}=this['{names['state']}']['length'];{names['index']}<{names['length']};{names['index']}++){{this['{names['state']}']['push'](Math['round'](Math['random']())),{names['length']}=this['{names['state']}']['length'];}}
return {value}(this['{names['state']}'][0x0]);
}};
{call},{decoder}['{names['guard']}']=!![];
}}"""


def decoder(name,names,mode='valid',with_shell=True):
    guard=shell(name,names,mode=mode,enabled=with_shell)
    return f"""function {name}(a,b){{var c=tf();return {name}=function(d,e){{d=d-0x10;var f=c[d];{guard}var A='{ALPHABET}';return f;}},{name}(a,b);}}"""


def fixture(names=None,mode='valid',shells=2,sequence=False):
    names=names or BASE
    values="['%s','%s','%s','%s','%s']"%(VERSION,'X'+VERSION,*CIPHER)
    rotation="(function(a,b){var aM=dec,c=a();while(!![]){try{var d=parseInt(aM(0x10))/0x1;if(d===b)break;else c['push'](c['shift']());}catch(e){c['push'](c['shift']());}}}(tf,100))"
    second=decoder('dec2',names,mode=mode,with_shell=shells==2)
    completion=f"({rotation},$done({{body:d5(0x10)+dec2(0x10)}}));" if sequence else f"{rotation};\n$done({{body:d5(0x10)+dec2(0x10)}});"
    return f"""var _0xodK='{VERSION}';
function tf(){{var a={values};tf=function(){{return a;}};return tf();}}
{decoder('dec',names,mode=mode)}
{second}
var d0=dec,d1=d0,d2=d1,d3=d2,d4=d3,d5=d4;
{completion}
"""


def fold(source):
    result=subprocess.run(['node',str(FOLD)],input=source,cwd=ROOT,text=True,capture_output=True,check=True)
    return json.loads(result.stdout)


class CachedShellFamilyTests(unittest.TestCase):

    def test_rotation_removed_from_sequence_preserves_sibling_business(self):
        data=fold(fixture(sequence=True))
        self.assertNotIn('error',data)
        self.assertEqual(data['transformations'],1)
        self.assertIn('$done({body:"100"+"100"})',data['source'])
        self.assertNotIn('parseInt',data['source'])

    def test_random_key_variants_fold_every_shell_and_decode_through_deep_aliases(self):
        for names in (BASE,ALT):
            with self.subTest(names=names['shell']):
                data=fold(fixture(names))
                self.assertNotIn('error',data)
                self.assertEqual(data['transformations'],1)
                self.assertIn('$done({body:"100"+"100"});',data['source'])
                self.assertNotIn('new ',data['source'])
                self.assertNotIn('dec2(',data['source'])
                self.assertNotIn('d5(',data['source'])

    def test_constant_arithmetic_decoder_offsets_fold_and_unproven_offsets_remain_unfolded(self):
        valid=fixture().replace('d=d-0x10','d=d-(0x20-0x10)')
        data=fold(valid)
        self.assertNotIn('error',data)
        self.assertEqual(data['transformations'],1)
        self.assertIn('$done({body:"100"+"100"});',data['source'])
        for name,changed in {
            'dynamic_offset':fixture().replace('d=d-0x10','d=d-index'),
            'non_integer_offset':fixture().replace('d=d-0x10','d=d-(0x20/0x3)'),
        }.items():
            with self.subTest(name=name):
                data=fold(changed)
                self.assertNotIn('error',data)
                self.assertEqual(data['transformations'],0)
                self.assertIn('function dec(a,b)',data['source'])

    def test_constant_arithmetic_shell_state_folds_and_unproven_indices_are_rejected(self):
        valid=(fixture()
               .replace("this['state']=[0x1,0x0,0x0]","this['state']=[0x2-0x1,0x3-0x3,0x0*0x9]")
               .replace("--this['state'][0x1]","--this['state'][0x2-0x1]")
               .replace("--this['state'][0x0]","--this['state'][0x4-0x4]")
               .replace('for(var i=0x0','for(var i=0x1-0x1')
               .replace("this['state'][0x0]","this['state'][0x7-0x7]"))
        data=fold(valid)
        self.assertNotIn('error',data)
        self.assertEqual(data['transformations'],1)
        self.assertIn('$done({body:"100"+"100"});',data['source'])
        cases={
            'wrong_state_value':(valid.replace("this['state']=[0x2-0x1","this['state']=[0x2"),
                                 '缓存式自防御壳构造器结构不匹配'),
            'dynamic_state_index':(valid.replace("--this['state'][0x2-0x1]","--this['state'][i]"),
                                   '缓存式自防御壳使用了未审查的自由全局：i'),
            'wrong_recursive_counter':(valid.replace('for(var i=0x1-0x1','for(var i=0x2-0x1'),
                                      '缓存式自防御壳的失败路径方法不匹配'),
        }
        for name,(source,reason) in cases.items():
            with self.subTest(name=name):
                data=fold(source)
                self.assertIn('error',data)
                self.assertIn(reason,data['error'])

    def test_rotation_checksum_constant_member_lookup_folds_and_unsafe_objects_are_rejected(self):
        base=fixture()
        prefix="(function(a,b){var aM=dec,c=a();"
        declaration="(function(a,b){var offsets={'index':0x20,'base':0x10};var aM=dec,c=a();"
        valid=(base.replace(prefix,declaration)
                   .replace('parseInt(aM(0x10))','parseInt(aM(offsets.index-offsets.base))'))
        data=fold(valid)
        self.assertNotIn('error',data)
        self.assertEqual(data['transformations'],1)
        self.assertIn('$done({body:"100"+"100"});',data['source'])
        cases={
            'member_write':valid.replace("var offsets={'index':0x20,'base':0x10};",
                                         "var offsets={'index':0x20,'base':0x10};offsets.index=0x20;"),
            'dynamic_member':(valid.replace("var offsets={'index':0x20,'base':0x10};",
                                            "var offsets={'index':0x20,'base':0x10};var key='index';")
                              .replace('offsets.index-offsets.base','offsets[key]-offsets.base')),
            'object_escape':valid.replace("var offsets={'index':0x20,'base':0x10};",
                                          "var offsets={'index':0x20,'base':0x10};unknown(offsets);"),
            'non_literal_value':valid.replace("var offsets={'index':0x20,'base':0x10};",
                                              "var other=0x20;var offsets={'index':other,'base':0x10};"),
        }
        for name,source in cases.items():
            with self.subTest(name=name):
                data=fold(source)
                self.assertIn('error',data)
                self.assertIn('轮转校验在一轮内没有匹配',data['error'])

    def test_semantic_or_cardinality_changes_are_rejected(self):
        cases={
            'regex_changed':(dict(mode='regex'),'正则被改动'),
            'failure_path_reachable':(dict(mode='sample'),'失败路径可达'),
            'result_used':(dict(mode='result_used'),'自检结果没有被丢弃'),
            'external_write':(dict(mode='external_write'),'写入了外部绑定'),
            'decoder_argument_replaced':(dict(names=ALT),'解码器参数不匹配'),
            'failure_path_bypassed':(dict(mode='bypass'),'短路辅助方法不匹配'),
            'shell_count_mismatch':(dict(shells=1),'外壳数量不一致'),
        }
        for name,(options,reason)in cases.items():
            with self.subTest(name=name):
                source=fixture(**options)
                if name=='decoder_argument_replaced':
                    source=source.replace(f"new {ALT['shell']}(dec)['{ALT['check']}']()",f"new {ALT['shell']}(dec2)['{ALT['check']}']()",1)
                data=fold(source)
                self.assertIn('error',data)
                self.assertIn(reason,data['error'])

    def test_unreviewed_free_global_and_shadowing_are_rejected(self):
        for inserted,reason in [("window['x']=0x1;",'未审查的自由全局'),("var Math={};",'自由全局'),("Math['x']=0x1;",'写入了自由全局')]:
            with self.subTest(inserted=inserted):
                source=fixture().replace("var re=new RegExp",inserted+"var re=new RegExp",1)
                data=fold(source)
                self.assertIn('error',data)
                self.assertIn(reason,data['error'])

    @unittest.skipUnless(os.environ.get('EGERN_CACHED_SHELL_CORPUS'),'Set EGERN_CACHED_SHELL_CORPUS to the local impact index')
    def test_real_corpus_folds_all_cached_shells(self):
        result=subprocess.run(['node',str(CORPUS),os.environ['EGERN_CACHED_SHELL_CORPUS']],cwd=ROOT,text=True,capture_output=True,check=True)
        data=json.loads(result.stdout)
        self.assertEqual(data['foldedTwoShellFiles'],34)
        self.assertEqual(data['foldedTwoShells'],68)
        self.assertEqual(data['failures'],[])


if __name__=='__main__':
    unittest.main()
