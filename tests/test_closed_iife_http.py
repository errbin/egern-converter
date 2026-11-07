"""Closed IIFE factories and callback builders retain native completion flow."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare
URL='https://example.test/script.js'
class ClosedIIFEHTTPTests(unittest.TestCase):
    def test_closed_iife_preserves_state_and_completion(self):
        for head in ['()=>', 'function()']:
            source='''const api=(HEAD{const prefix='saved:';
const save=value=>$persistentStore.write(prefix+value,'key');
const done=()=>{$done({body:$persistentStore.read('key')})};
return {save,done};})();api.save('value');api.done();'''.replace('HEAD',head)
            output=convert_script(source,'Fixture',URL,'',source_format='loon')
            result=compare(source,output,'loon',URL,{'name':'closed IIFE','request':{'url':URL},'expected':{'result':{'body':'saved:value'}}})
            self.assertEqual(result['status'],'passed',result)
            self.assertNotIn('$done',output)

    def test_returned_selected_http_and_nested_builder_preserve_live_fields(self):
        source='''function send(method,input,callback){const opts={};{{opts.url=input.url;}}
if(input.headers)opts.headers=input.headers;
if(input.body)opts.body=input.body;
const runner=method==='GET'?$httpClient.get:$httpClient.post;
return runner(opts,callback);}
(async()=>{const value=await new Promise(resolve=>{
send($request.method,{url:'https://api.test/',headers:{X:'kept'},body:$persistentStore.read('body')},(e,r,b)=>resolve(e||b));
});$done({body:value})})();'''
        output=convert_script(source,'Fixture',URL,'',source_format='loon')
        for method in ['GET','POST']:
            for body in ['', 'sent']:
                for reply,value in [({'body':'ok'},'ok'),({'error':'offline'},'offline')]:
                    fixture={'name':'selected callback','request':{'url':URL,'method':method},'storage':{'body':body},'http':[{'url':'https://api.test/',**reply}], 'expected':{'result':{'body':value},'events':{'requests':[{'method':method, 'headers':{'x':'kept'},**({'body':body} if body else {})}]}}}
                    result=compare(source,output,'loon',URL,fixture)
                    self.assertEqual(result['status'],'passed',result)

    def test_async_return_used_by_await_is_not_serialized(self):
        source='''async function send(){return $httpClient.get('https://api.test/',(e,r,b)=>$persistentStore.write(b,'key'))}
(async()=>{await send();$done({body:$persistentStore.read('key')||'empty'})})();'''
        with self.assertRaisesRegex(ConversionError,'立即返回值被使用'):
            convert_script(source,'Fixture',URL,'',source_format='loon')

    def test_conditional_url_without_dominance_is_rejected(self):
        source="const opts={};if($persistentStore.read('enabled'))opts.url='https://api.test/';$httpClient.get(opts,(e,r,b)=>$done({body:b}));"
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'',source_format='loon')
