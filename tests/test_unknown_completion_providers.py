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


if __name__=='__main__':
    unittest.main()
