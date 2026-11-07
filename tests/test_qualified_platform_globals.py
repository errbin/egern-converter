"""Qualified selected host inputs lower without creating lexical shadowing."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError
URL='https://example.test/qualified.js'
class QualifiedPlatformGlobalsTests(unittest.TestCase):
    def check(self,source,expected,**fixture):
        native=convert_script(source,'Fixture',URL,'',source_format='loon')
        result=compare(source,native,'loon',URL,{'name':'qualified host input','request':{'url':URL},'expected':expected,**fixture})
        self.assertEqual(result['status'],'passed',result)
        return native

    def test_qualified_argument_and_absent_other_host_input(self):
        self.check('const values=(globalThis.$intent?.parameter??globalThis.$argument)?.split(",")??[];$done({body:JSON.stringify(values)});',{'result':{'body':'["a","b"]'}},argument='a,b')
        self.check('globalThis["$done"]({body:globalThis["$argument"]});',{'result':{'body':'value'}},argument='value')

    def test_qualified_callback_client_uses_direct_native_fetch(self):
        native=self.check('globalThis.$httpClient.get("https://api.test/",(e,r,b)=>globalThis.$done({body:b}));',{'result':{'body':'reply'}},http=[{'url':'https://api.test/','body':'reply'}])
        self.assertIn('.http.get(',native)
        self.assertNotIn('globalThis.$httpClient',native)

    def test_local_global_object_keeps_ordinary_javascript_semantics(self):
        self.check('const globalThis={$argument:"local"};$done({body:globalThis.$argument});', {"result":{"body":"local"}})

    def test_shadows_and_global_object_escapes_do_not_acquire_host_proofs(self):
        for source in [
            'function f($argument){$done({body:globalThis.$argument})}f("local");',
            'globalThis.$argument="changed";$done({body:globalThis.$argument});',
            'unknown(globalThis);$done({body:globalThis.$argument});',
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'',source_format='loon')
