"""内联完成函数只允许封闭调用形态；别名、属性、数组/展开和未知运行时必须拒绝。"""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError
URL='https://example.test/inline-completion.js'

class InlineCompletionShapeTests(unittest.TestCase):
    def check(self,source):
        output=convert_script(source,'Fixture',URL,'')
        case={'name':'inline completion','request':{'url':URL},'expected':{'result':{'body':'ok'}}}
        result=compare(source,output,'surge',URL,case)
        self.assertEqual(result['status'],'passed',result)

    def test_closed_direct_driver_is_accepted(self):
        self.check("function run(cb){return cb()}run(function(){$done({body:'ok'})});")
        self.check("const h={cb:function(){$done({body:'ok'})}};h.cb();")

    def test_unprovable_shapes_are_rejected(self):
        for source in [
            "unknown(function(){$done({body:'ok'})});",
            "const cb=function(){$done({body:'ok'})};unknown(cb);",
            "const h={cb:function(){$done({body:'ok'})}};unknown(h);",
            "unknown([function(){$done({body:'ok'})}]);",
            "unknown(...[function(){$done({body:'ok'})}]);",
            "const runtime={wrap(inner,outer){return {next(){return inner({})}}}};"
            "const g=runtime.wrap(function(){$done({body:'ok'})},function(){});g.next();",
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'')
