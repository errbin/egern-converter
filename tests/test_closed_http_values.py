import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare

URL='https://example.test/source.js'


class ClosedHTTPValueTests(unittest.TestCase):
    def check(self,source,fixture):
        output=convert_script(source,'Author',URL,'',source_format='loon')
        result=compare(source,output,'loon',URL,fixture)
        self.assertEqual(result['status'],'passed',result)
        self.assertIn('ctx.http.get(',output)
        self.assertNotIn('$httpClient',output)

    def test_url_parameters_are_inferred_across_closed_functions(self):
        source='''function get(url){return new Promise((resolve,reject)=>{
$httpClient.get(url,(error,response,body)=>{if(error)reject(error);else resolve(body)})})}
const url=$request.url;get(url).then(body=>$done({body}));'''
        self.check(source,{'name':'closed URL forwarding','request':{'url':'https://example.test/'},
                           'http':[{'url':'https://example.test/','body':'received'}],
                           'expected':{'result':{'body':'received'}}})

    def test_json_string_operations_and_iife_captures_preserve_url(self):
        source='''const data=JSON.parse($response.body);
function get(url){return new Promise((resolve,reject)=>{
$httpClient.get(url,(error,response,body)=>{if(error)reject(error);else resolve(body)})})}
(async()=>{let url=data.url.replace("old","new");url+="?key=fixture";
await get(url).then(body=>$done({body}));})();'''
        self.check(source,{'name':'JSON URL forwarding','request':{'url':'https://example.test/'},
                           'response':{'body':'{"url":"https://api.test/old"}'},
                           'http':[{'url':'https://api.test/new?key=fixture','body':'received'}],
                           'expected':{'result':{'body':'received'}}})

    def test_unknown_objects_revivers_aliases_and_mutations_are_not_typed_as_urls(self):
        prefix='function get(url){return new Promise((resolve,reject)=>{$httpClient.get(url,(e,r,b)=>{if(e)reject(e);else resolve(b)})})}'
        for call in [
            'const x={replace(){return {url:"https://api.test/",unknown:1}}};get(x.replace()).then(body=>$done({body}));',
            'const d=JSON.parse("{}",()=>({replace(){return {url:"https://api.test/"}}}));get(d.replace()).then(body=>$done({body}));',
            'unknown(get);get("https://api.test/").then(body=>$done({body}));',
            'let url="https://api.test/";url={url};get(url).then(body=>$done({body}));',
            'const d=JSON.parse("{}");d.url={replace(){return {url:"https://api.test/"}}};get(d.url.replace()).then(body=>$done({body}));',
            'const d=JSON.parse("{}");const alias=d.url;alias.replace=()=>({url:"https://api.test/"});get(d.url.replace()).then(body=>$done({body}));',
        ]:
            with self.subTest(call=call),self.assertRaises(ConversionError):
                convert_script(prefix+call,'Author',URL,'',source_format='loon')

    def test_conditional_native_notification_actions_preserve_presence(self):
        source='''function notify(url){const options={};if(url)options.openUrl=url;
if(JSON.stringify(options)==="{}")$notification.post("title","","body");
else $notification.post("title","","body",options)}notify($request.url);$done({});'''
        output=convert_script(source,'Author',URL,'',source_format='loon')
        for value in ['https://example.test/','']:
            fixture={'name':'conditional action','request':{'url':value}}
            self.assertEqual(compare(source,output,'loon',URL,fixture)['status'],'passed')
        self.assertIn('ctx.notify(',output)
        with self.assertRaises(ConversionError):
            convert_script(source.replace('if(url)options.openUrl=url;','unknown(options);if(url)options.openUrl=url;'),'Author',URL,'',source_format='loon')
