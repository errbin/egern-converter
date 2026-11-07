"""Only exact, closed public libraries establish non-callable result shapes."""
import json
from pathlib import Path
import unittest

from tools.egern_hub.js_analysis import analyze_many
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'sources/chavyleung/scripts/master/10000/10000.js'
URL='https://example.test/library-values.js'

def to_string_proofs(sources):
    """Test data-flow facts without treating native toString as a banned API."""
    import subprocess
    code="""import {parse} from './tools/js-analysis/core/syntax.mjs';
import {index,property} from './tools/js-analysis/core/ast.mjs';
import {ordinaryReceivers} from './tools/js-analysis/analysis/values.mjs';
import {protectLibraries} from './tools/js-analysis/analysis/libraries.mjs';
let text='';for await(const chunk of process.stdin)text+=chunk;
const results=JSON.parse(text).map(source=>{
 const libraries=protectLibraries(source),tree=parse(libraries.source,{ecmaVersion:'latest'});
 const ix=index(tree),proof=ordinaryReceivers(tree,libraries.valueContracts);
 return ix.nodes.filter(n=>n.type==='CallExpression'&&property(n.callee)==='toString').map(n=>proof.safeToString(n));
});process.stdout.write(JSON.stringify(results));"""
    result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(sources),
                          text=True,capture_output=True,cwd=ROOT,check=True)
    return json.loads(result.stdout)

@unittest.skipUnless(SOURCE.is_file(),'Requires cached public CryptoJS bundle')
class LibraryValueContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source=SOURCE.read_text()
        report=analyze_many([(source,'loon',json.dumps({'entry_types':['schedule']}))],mode='native')[0]
        block=next(b for b in report['libraries'] if b['name']=='CryptoJS embedded full bundle')
        cls.library=source.encode('utf-16-le')[block['start']*2:block['end']*2].decode('utf-16-le')

    def test_known_answer_md5_and_aes_preserve_the_complete_original_library(self):
        examples=[
            ('const c=CryptoJS;const result=c.MD5("abc");$done({body:result.toString()});','900150983cd24fb0d6963f7d28e17f72'),
            ('let c;c=CryptoJS;const result=c.AES.encrypt(c.enc.Utf8.parse("hello"),c.enc.Utf8.parse("1234567890123456"),{mode:c.mode.ECB,padding:c.pad.Pkcs7});$done({body:result.toString()});','67fHA+Z12z2jlwOLTBeCPA=='),
        ]
        for code,expected in examples:
            source=self.library+'\n'+code
            output=convert_script(source,'Fixture',URL,'',source_format='loon')
            self.assertIn(self.library,output)
            result=compare(source,output,'loon',URL,{'name':'known answer','request':{'url':URL},'expected':{'result':{'body':expected}}})
            self.assertEqual(result['status'],'passed',result)

    def test_des_and_triple_des_results_remain_inside_the_preserved_library_contract(self):
        examples=[
            'CryptoJS.DES.encrypt(CryptoJS.enc.Utf8.parse("hello"),CryptoJS.enc.Hex.parse("0123456789abcdef"),{mode:CryptoJS.mode.ECB,padding:CryptoJS.pad.Pkcs7}).toString()',
            'CryptoJS.TripleDES.encrypt(CryptoJS.enc.Utf8.parse("hello"),CryptoJS.enc.Hex.parse("0123456789abcdef0123456789abcdef0123456789abcdef"),{mode:CryptoJS.mode.ECB,padding:CryptoJS.pad.Pkcs7}).toString()',
        ]
        for expression in examples:
            source=self.library+'\n$done({body:'+expression+'});'
            output=convert_script(source,'Fixture',URL,'',source_format='loon')
            self.assertIn(self.library,output)
            result=compare(source,output,'loon',URL,{'name':'preserved cipher result','request':{'url':URL}})
            self.assertEqual(result['status'],'passed',result)

    def test_closed_environment_namespace_alias_retains_library_result_proofs(self):
        suffix='''const $={};$.CryptoJS=CryptoJS;
const value=$.CryptoJS.DES.encrypt($.CryptoJS.enc.Utf8.parse("hello"),$.CryptoJS.enc.Hex.parse("0123456789abcdef"),{mode:$.CryptoJS.mode.ECB,padding:$.CryptoJS.pad.Pkcs7});
$done({body:value.toString($.CryptoJS.enc.Hex)});'''
        source=self.library+'\n'+suffix
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        self.assertIn(self.library,output)
        result=compare(source,output,'loon',URL,{'name':'closed namespace alias','request':{'url':URL}})
        self.assertEqual(result['status'],'passed',result)
        for mutation in ['unknown($);','$.CryptoJS=unknown;']:
            with self.subTest(mutation=mutation):
                source=(self.library+'\nconst $={};$.CryptoJS=CryptoJS;'+mutation+
                    '$done({body:$.CryptoJS.DES.encrypt("hello",$.CryptoJS.enc.Hex.parse("0123456789abcdef"),{mode:$.CryptoJS.mode.ECB}).toString()});')
                self.assertEqual(to_string_proofs([source]),[[False]])
                self.assertIn('.toString()',convert_script(source,'Fixture',URL,'',source_format='loon'))

    def test_mutation_escape_shadowing_and_unknown_results_do_not_inherit_proofs(self):
        for code in [
            'CryptoJS.MD5=()=>function hidden(){};$done({body:CryptoJS.MD5("abc").toString()});',
            'unknown(CryptoJS);$done({body:CryptoJS.MD5("abc").toString()});',
            'const c=CryptoJS;unknown(c);$done({body:c.MD5("abc").toString()});',
            'const c=CryptoJS;c.MD5=()=>function hidden(){};$done({body:c.MD5("abc").toString()});',
            'const c=CryptoJS;unknown(c.mode);$done({body:c.MD5("abc").toString()});',
            'function f(CryptoJS){return CryptoJS.MD5("abc").toString()}$done({body:f(unknown())});',
            'const c=CryptoJS;$done({body:c.unknown("abc").toString()});',
        ]:
            with self.subTest(code=code):
                self.assertEqual(to_string_proofs([self.library+'\n'+code]),[[False]])
                self.assertIn('.toString()',convert_script(self.library+'\n'+code,'Fixture',URL,'',source_format='loon'))
        source='const c=CryptoJS;$done({body:c.MD5("abc").toString()});'
        self.assertEqual(to_string_proofs([source]),[[False]])
        self.assertIn('.toString()',convert_script(source,'Fixture',URL,'',source_format='loon'))

    def test_changed_library_loses_its_contract(self):
        changed=self.library.replace('8421888','8421889',1)
        self.assertNotEqual(changed,self.library)
        with self.assertRaises(ConversionError):
            convert_script(changed+'\n$done({body:CryptoJS.MD5("abc").toString()});','Fixture',URL,'',source_format='loon')

class LibraryNamespaceProofTests(unittest.TestCase):
    def test_only_closed_namespaces_gain_the_reviewed_result_shape(self):
        import subprocess
        examples=[
            ('const r=Known.digest("a");r.toString();',1),
            ('let c;c=Known;const r=c.digest("a");r.toString();',1),
            ('const c=Known;c.digest=unknown;const r=c.digest("a");r.toString();',0),
            ('const c=Known;unknown(c);const r=c.digest("a");r.toString();',0),
            ('unknown(Known.options);Known.digest("a").toString();',0),
            ('const Known=unknown();Known.digest("a").toString();',0),
            ('Known.other("a").toString();',0),
            ('let c=Known;c=unknown();c.digest("a").toString();',0),
            ('Known.digest("a",{mode:Known.options.mode}).toString();',1),
        ]
        code="""
import {parse} from './tools/js-analysis/core/syntax.mjs';
import {index,property} from './tools/js-analysis/core/ast.mjs';
import {libraryValues} from './tools/js-analysis/analysis/values.mjs';
let text='';for await(const chunk of process.stdin)text+=chunk;
const output=JSON.parse(text).map(([source])=>{
 const ix=index(parse(source,{ecmaVersion:'latest'}));
 const proof=libraryValues(ix,[{global:'Known',nonCallableCalls:['digest']}]);
 return ix.nodes.filter(n=>n.type==='CallExpression'&&property(n.callee)==='toString'&&proof.nonCallable(n.callee.object)).length;
});
process.stdout.write(JSON.stringify(output));
"""
        result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(examples),text=True,capture_output=True,cwd=ROOT,check=True)
        self.assertEqual(json.loads(result.stdout),[count for _,count in examples])
