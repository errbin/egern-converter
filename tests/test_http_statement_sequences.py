"""Discarded HTTP expressions keep their branches and evaluation order."""
import unittest
import subprocess
from pathlib import Path

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/script.js'


class HTTPStatementSequenceTests(unittest.TestCase):
    def test_repeated_normalization_does_not_add_blocks_around_direct_requests(self):
        module = (Path(__file__).resolve().parents[1] / 'tools/js-analysis/compiler/flow.mjs').as_uri()
        script = '''import {completionStatements} from MODULE;
let value="false, $httpClient.get('https://api.test/', (e,r,b)=>$done({body:b}));";
const first=completionStatements(value);
for(let pass=0;pass<20;pass++)value=completionStatements(value);
if(value!==first)throw Error('HTTP normalization keeps expanding the source');'''.replace('MODULE', repr(module))
        result = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_sequence_in_closed_env_callback_retains_header_work_and_completion(self):
        source = '''let order='';
function run() {
  ((options, callback) => {
    options.headers && (delete options.headers['Content-Length'], order+='headers:');
    (false, $httpClient.get(options, (e,r,b)=>{
      if(!e && r){r.body=b;r.statusCode=r.status}
      callback(e,r,b);
    }));
  })({url:'https://api.test/',headers:{X:'kept','Content-Length':'99'}},
    (e,r,b)=>$done({body:order+(e||r.body)}));
}
run();'''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertNotIn('$httpClient', output)
        self.assertIn('ctx.http.get', output)
        for reply, text in [({'body':'ok'}, 'ok'), ({'error':'offline'}, 'offline')]:
            result = compare(source, output, 'loon', URL, {
                'name':'discarded HTTP sequence', 'request':{'url':URL},
                'http':[{'url':'https://api.test/', **reply}],
                'expected':{'result':{'body':'headers:'+text},
                            'events':{'requests':[{'headers':{'x':'kept'}}]}}})
            self.assertEqual(result['status'], 'passed', result)

    def test_logical_and_conditional_requests_keep_their_original_guards(self):
        for expression in [
            "enabled && (order+='send:', $httpClient.get('https://api.test/', callback))",
            "enabled ? (order+='send:', $httpClient.get('https://api.test/', callback)) : order+='skip:'",
        ]:
            source = "const enabled=!!$persistentStore.read('enabled');let order='';" \
                     "function callback(e,r,b){$done({body:order+b})}if(!enabled)$done({body:'inactive'});" + expression + ';'
            output = convert_script(source, 'Fixture', URL, '', source_format='loon')
            for enabled in [False, True]:
                result = compare(source, output, 'loon', URL, {
                    'name':'guarded HTTP sequence', 'request':{'url':URL},
                    'storage':{'enabled':'yes'} if enabled else {},
                    'http':[{'url':'https://api.test/','body':'ok'}] if enabled else [],
                    'expected':{'result':{'body':'send:ok' if enabled else 'inactive'}}})
                self.assertEqual(result['status'], 'passed', result)

    def test_sequence_splitting_does_not_serialize_later_live_work(self):
        for expression in [
            "enabled && (order+='send:', $httpClient.get('https://api.test/', callback))",
            "enabled ? (order+='send:', $httpClient.get('https://api.test/', callback)) : order+='skip:'",
        ]:
            source = "const enabled=!!$persistentStore.read('enabled');let order='';" \
                     "function callback(e,r,b){$done({body:order+b})}" + expression + ';'
            # The inactive branch deliberately has its own completion path.
            source += "if(!enabled)$done({body:order+'inactive'});"
            # A completing HTTP operation with later live work is still rejected;
            # splitting the sequence must not turn concurrent work into serial work.
            with self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_used_http_values_are_not_mistaken_for_discarded_statements(self):
        for source in [
            "const x=(false,$httpClient.get('https://api.test/',()=>{}));$done({body:String(x)});",
            "consume((false,$httpClient.get('https://api.test/',()=>{})));$done({});",
        ]:
            with self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')
