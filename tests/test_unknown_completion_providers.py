"""完成入口必须追溯到本地已证明的提供者，未知构造实例不能按名称放行。"""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare


URL='https://example.test/completion-provider.js'


class UnknownCompletionProviderTests(unittest.TestCase):
    def test_unknown_provider_member_completion_is_not_an_entry(self):
        source=(
            "const $=new Env('one',{logLevel:'info'});(async()=>{"
            "if($response.body)$['done']({});else $['done']({body:$response.body});})();"
        )
        with self.assertRaisesRegex(ConversionError,'没有可识别的 \\$done 完成入口'):
            convert_script(source,'Fixture',URL,'',source_format='qx')

    def test_closed_provider_member_completion_remains_convertible(self):
        source=(
            "function Env(name){return new class{done(value){$done(value)}}}"
            "(async()=>{const $=new Env('fixture');"
            "if(!$response.body)$['done']({body:'empty'});"
            "else $['done']({body:$response.body});})();"
        )
        native=convert_script(source,'Fixture',URL,'',source_format='qx')
        case={'name':'closed completion provider','request':{'url':URL},
              'response':{'body':'ok'},'expected':{'result':{'body':'ok'}}}
        result=compare(source,native,'qx',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_factory_returned_object_completion_is_an_entry(self):
        source=(
            "function Env(name){return {name,done:v=>{$done(v)},asset:null}}"
            "(async()=>{const $=new Env('fixture');$.asset={owner:'x'};"
            "if(!$response.body)$.done({body:'empty'});"
            "else $.done({body:$response.body});})();"
        )
        native=convert_script(source,'Fixture',URL,'',source_format='qx')
        case={'name':'factory returned object','request':{'url':URL},
              'response':{'body':'ok'},'expected':{'result':{'body':'ok'}}}
        result=compare(source,native,'qx',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_factory_returned_object_rejects_mutable_or_escaped_methods(self):
        entries=[
            "function Env(name){return {done:v=>{$done(v)}}}"
            "(async()=>{let $=new Env('fixture');$=new Env('other');$.done({body:'ok'});})();",
            "function Env(name){return {[name]:v=>{$done(v)}}}"
            "(async()=>{const $=new Env('done');$.done({body:'ok'});})();",
            "function Env(name){return {done:v=>{$done(v)}}}"
            "(async()=>{const $=new Env('fixture');$.done=()=>{};$.done({body:'ok'});})();",
            "function Env(name){return {done:v=>{$done(v)}}}"
            "(async()=>{const $=new Env('fixture');unknown($.done);$.done({body:'ok'});})();",
            "function Env(name){return {done:v=>{$done(v)}}}"
            "(async()=>{const $=new Env('fixture');unknown($);$.done({body:'ok'});})();",
            "function Env(name){if(name)return {done:v=>{$done(v)}};"
            "return {done:v=>{$done(v)}}}"
            "(async()=>{const $=new Env('fixture');$.done({body:'ok'});})();",
            "async function Env(name){return {done:v=>{$done(v)}}}"
            "(async()=>{const $=new Env('fixture');$.done({body:'ok'});})();",
            "function* Env(name){return {done:v=>{$done(v)}}}"
            "(async()=>{const $=new Env('fixture');$.done({body:'ok'});})();",
        ]
        for entry in entries:
            with self.subTest(entry=entry),self.assertRaises(ConversionError):
                convert_script(entry,'Fixture',URL,'',source_format='qx')


if __name__=='__main__':
    unittest.main()
