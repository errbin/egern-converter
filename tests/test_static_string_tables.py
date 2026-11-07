"""Static data decoding keeps the input business AST, not a replacement payload."""
import json
from pathlib import Path
import re
import subprocess
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'sources/fmz200/wool_scripts/main/Scripts/quark.js'
URL='https://raw.githubusercontent.com/fmz200/wool_scripts/main/Scripts/quark.js'


@unittest.skipUnless(SOURCE.is_file(),'Requires the cached upstream string-table script')
class StaticStringTableTests(unittest.TestCase):

    def test_changed_business_is_read_from_source_and_local_codec_renaming_is_supported(self):
        source=SOURCE.read_text()
        modified=source.replace("$done({'body':", "obj.result.marker='changed-source';$done({'body':",1)
        self.assertNotEqual(modified,source)
        modified=re.sub(r'\b_0xd235\b','decodeLiteral',modified)
        output=convert_script(modified,'Author',URL,'',source_format='loon')
        case={'name':'input business retained','request':{'url':'https://example.test/'},
              'response':{'body':'{"result":{"cms_ad":true,"keep":2}}'},
              'original_timers':[2000],'timers':[],
              'expected':{'result':{'body':'{"result":{"keep":2,"marker":"changed-source"}}'}}}
        self.assertEqual(compare(modified,output,'loon',URL,case)['status'],'passed')

    def test_modified_shell_decoder_and_business_shell_dependencies_are_rejected(self):
        source=SOURCE.read_text()
        for changed in [source.replace('0x7d0','0x7d1',1),
                        source.replace('^_0x4463d7','+_0x4463d7',1),
                        source.replace("$done({'body':", "console.log('observed');$done({'body':",1),
                        source.replace("$done({'body':", "version_='changed';$done({'body':",1)]:
            with self.subTest(),self.assertRaises(ConversionError):
                self.assertNotEqual(changed,source)
                convert_script(changed,'Author',URL,'',source_format='loon')

    def test_business_cannot_move_before_decoder_initialization(self):
        source=SOURCE.read_text()
        begin=source.index('var obj=JSON[')
        end=source.index('function _0x582a',begin)
        moved=source[begin:end]+source[:begin]+source[end:]
        with self.assertRaises(ConversionError):
            convert_script(moved,'Author',URL,'',source_format='loon')


class GeneratedSchemaTests(unittest.TestCase):
    def test_known_runtime_schema_blocks_restore_exactly_and_do_not_hide_proxy_apis(self):
        folder=ROOT/'sources/kokoryh/Sparkle/master/dist'
        if not (folder/'bilibili.protobuf.response.js').is_file():self.skipTest('Requires the Sparkle snapshot')
        code=r'''import fs from 'node:fs';
import {protectLibraries} from './tools/js-analysis/analysis/libraries.mjs';
import {native} from './tools/js-analysis/compiler/native.mjs';
let paths=JSON.parse(fs.readFileSync(0,'utf8'));const result=[];
for(const path of paths){const source=fs.readFileSync(path,'utf8'),lib=protectLibraries(source);
const restored=lib.restore(lib.source);const changed=source.replace(/internalBinaryRead\(([^)]*)\)\{/,'internalBinaryRead($1){$done({});');
const bad=protectLibraries(changed),api=changed.indexOf('$done({});',changed.indexOf('internalBinaryRead('));
result.push({restored:restored===source,noInspectionError:!native(source,'loon',{binary:true}).errors.some(e=>e.includes('toString')),
notHidden:!bad.blocks.some(b=>api>=b.start&&api<b.end)});}
process.stdout.write(JSON.stringify(result));'''
        paths=[str(folder/name) for name in ['bilibili.protobuf.request.js','bilibili.protobuf.response.js']]
        run=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(paths),cwd=ROOT,text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(run.stdout),[{'restored':True,'noInspectionError':True,'notHidden':True}]*2)
