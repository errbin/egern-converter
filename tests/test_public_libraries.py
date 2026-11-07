"""Public library code stays intact; proxy APIs and business flow are compiled."""
import json
from pathlib import Path
import subprocess
import unittest

from tools.egern_hub.js_analysis import analyze_many
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
TIEBA=ROOT/'sources/app2smile/rules/master/js/tieba-proto.js'
BAIDU=ROOT/'sources/fmz200/wool_scripts/main/Scripts/baidumap.js'
WYRES=ROOT/'sources/Keywos/rule/main/script/wy/js/wyres.js'
WECHAT=ROOT/'sources/zZPiglet/Task/master/asset/UnblockURLinWeChat.js'

def js_slice(source, block):
    return source.encode('utf-16-le')[block['start']*2:block['end']*2].decode('utf-16-le')


class PublicLibraryBoundaryTests(unittest.TestCase):
    def test_mutable_finally_result_uses_first_completion_and_preserves_exceptions(self):
        source='let result={};try{if($request.url.includes("early"))$done({body:"early"});if($request.url.includes("error"))throw Error("synthetic");result={body:"late"}}catch(e){result={body:e.message}}finally{$done(result)}'
        output=convert_script(source,'Original','https://example.test/a.js','')
        for path in ['early','late','error']:
            fixture={'name':path,'request':{'url':'https://example.test/'+path},'expected':{'result':{'body':'synthetic' if path=='error' else path}}}
            self.assertEqual(compare(source,output,'surge','https://example.test/a.js',fixture)['status'],'passed')
        for operation in ['unknown(result);', 'Object.assign(result,{body:"hidden"});', 'result=unknown();']:
            unsafe='let result={};try{result={body:"ok"};'+operation+'}finally{$done(result)}'
            with self.subTest(operation=operation),self.assertRaises(ConversionError):
                convert_script(unsafe,'Original','https://example.test/a.js','')

    def test_library_comments_never_exempt_unconverted_business_apis(self):
        for source in [
            '// text-decoder\neval("$done({})");',
            '// protobuf-ts 2.10.0\nunknown(globalThis.$request);$done({});',
            '/* protobuf.js */unknown(this.$response);$done({});',
        ]:
            with self.subTest(source=source),self.assertRaises(ConversionError):
                convert_script(source,'Original','https://example.test/a.js','')

    def test_standard_global_reads_are_js_and_platform_globals_are_rejected(self):
        source='$done({body:globalThis.Object.keys({a:1}).join(",")});'
        output=convert_script(source,'Original','https://example.test/a.js','')
        fixture={'name':'standard global','request':{'url':'https://example.test/'},'expected':{'result':{'body':'a'}}}
        self.assertEqual(compare(source,output,'surge','https://example.test/a.js',fixture)['status'],'passed')
        for value in ['globalThis.$response','globalThis.process','globalThis["$request"]']:
            with self.assertRaises(ConversionError):convert_script('$done({body:'+value+'});','Original','https://example.test/a.js','')
        with self.assertRaises(ConversionError):convert_script('globalThis.Object={};$done({});','Original','https://example.test/a.js','')


@unittest.skipUnless(TIEBA.is_file() and BAIDU.is_file(),'Fetch the public source snapshots for embedded library integration tests')
class PublicLibraryIntegrationTests(unittest.TestCase):

    @unittest.skipUnless(WECHAT.is_file(),'Requires cached original entities/Base64 libraries')
    def test_html_entities_and_base64_keep_global_exports_and_original_bytes(self):
        source=WECHAT.read_text();report=self.report(source)
        self.assertEqual([b['name'] for b in report['libraries']],['he HTML entities','js-base64 3.7.2'])
        libraries='\n'.join(js_slice(source,b) for b in report['libraries'])
        sample=libraries+'\n$done({body:he.decode("&amp;")+Base64.decode("YQ==")});'
        output=convert_script(sample,'Original','https://example.test/a.js','')
        for b in report['libraries']:self.assertIn(js_slice(source,b),output)
        fixture={'name':'entities/base64','request':{'url':'https://example.test/'},'expected':{'result':{'body':'&a'}}}
        result=compare(sample,output,'surge','https://example.test/a.js',fixture)
        self.assertEqual(result['status'],'passed',result)

    def report(self,source):
        return analyze_many([(source,'loon','{"binary":true}')],mode='native')[0]

    def test_original_library_blocks_are_retained_byte_for_byte(self):
        for path,names in [(TIEBA,['text-encoding','protobuf-ts runtime 2.10.0']),
                           (BAIDU,['protobuf.js embedded bundle','js-md5 embedded variant'])]:
            source=path.read_text();report=self.report(source)
            self.assertEqual(report['errors'],[],report)
            self.assertEqual([b['name'] for b in report['libraries']],names)
            self.assertNotIn('publicLibraryBlock',report['code'])
            for block in report['libraries']:
                self.assertIn(source[block['start']:block['end']],report['code'])
            self.assertNotIn('$done(',report['code'])
            self.assertIn('ctx.response',report['code'])

    def test_batch_conversion_returns_metadata_without_mutating_inputs(self):
        from tools.egern_hub.script_convert import convert_scripts
        item={'id':'fixture','source':TIEBA.read_text(),'source_format':'loon','binary':True,
              'author':'app2smile','url':'https://example.test/tieba.js','license_text':''}
        before=dict(item);metadata={}
        convert_scripts([item],metadata=metadata)
        self.assertEqual(item,before)
        self.assertEqual([b['name'] for b in metadata['fixture']['preserved_libraries']],['text-encoding','protobuf-ts runtime 2.10.0'])

    def test_changed_or_spoofed_library_fails_normal_analysis(self):
        source=TIEBA.read_text()
        changed=source.replace('Could not convert argument to dictionary','Changed behavior',1)
        report=self.report(changed)
        self.assertTrue(report['errors'])
        self.assertNotIn('text-encoding',[b['name'] for b in report['libraries']])
        # The global receiver bridge must not pick up an author's local object.
        report=self.report('const globalThis={};'+source)
        self.assertTrue(report['errors'])

    def test_one_line_library_and_business_stay_one_line(self):
        original=TIEBA.read_text();report=self.report(original)
        block=report['libraries'][0]
        source=original[block['start']:block['end']]+'$done({body:"ok"});'
        output=self.report(source)
        self.assertFalse(output['errors'],output['errors'])
        self.assertEqual(len(output['code'].splitlines()),1)


    @unittest.skipUnless((ROOT/'tools/js-readability/node_modules/acorn').exists(),'Optional readability dependencies required')
    def test_readability_also_preserves_public_libraries(self):
        from tools.egern_hub.deobfuscate import deobfuscate
        source=TIEBA.read_text();report=self.report(source)
        readable=deobfuscate(source)
        for block in report['libraries']:self.assertIn(source[block['start']:block['end']],readable)
        output=convert_script(source,'app2smile','https://example.test/tieba.js','',readable=True,binary=True,source_format='loon')
        for block in report['libraries']:self.assertIn(source[block['start']:block['end']],output)
        self.assertEqual(output.count('}).call(globalThis)'),1)

    def test_existing_native_youtube_keeps_its_nested_runtime(self):
        path=ROOT/'sources/Maasea/sgmodule/master/Script/Youtube/youtube.response.js'
        if not path.is_file():self.skipTest('Fetch the Maasea snapshot')
        source=path.read_text();report=self.report(source)
        self.assertFalse(report['errors'],report['errors'])
        self.assertTrue(report['libraries'])
        for block in report['libraries']:self.assertIn(source[block['start']:block['end']],report['code'])

    def test_external_runtime_helper_cannot_hide_platform_completion(self):
        path=ROOT/'sources/kokoryh/Sparkle/master/dist/bilibili.protobuf.request.js'
        if not path.is_file():self.skipTest('Fetch the Sparkle snapshot')
        source=path.read_text();report=self.report(source)
        # Snapshot revisions may change the complete runtime fingerprint. An
        # unmatched runtime must stay under ordinary platform API analysis.
        # Alter a hoisted library helper, while retaining the runtime block.
        code="""
import {parse} from './tools/js-analysis/vendor/acorn.mjs';
import {index} from './tools/js-analysis/core/ast.mjs';
let s='';for await(const c of process.stdin)s+=c;
const f=index(parse(s,{ecmaVersion:'latest'})).nodes.find(n=>n.type==='FunctionDeclaration'&&s.slice(n.start,n.end).includes('invalid base64 string.'));
process.stdout.write(s.slice(0,f.body.start+1)+'$done({});'+s.slice(f.body.start+1));
"""
        changed=subprocess.run(['node','--input-type=module','-e',code],input=source,cwd=ROOT,text=True,capture_output=True,check=True).stdout
        report=self.report(changed)
        self.assertFalse(any('protobuf-ts' in b['name'] for b in report['libraries']))
        self.assertTrue(report['errors'])
