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

    def test_closed_default_object_parameter_requires_all_call_sites_omitted(self):
        source="function notify(opts={}){$notify('title','subtitle','body',opts)}notify();$done({body:'ok'});"
        output=convert_script(source,'Author',URL,'',source_format='qx')
        self.assertIn('ctx.notify(',output)
        fixture={'name':'closed default object','request':{'url':URL},
                 'expected':{'result':{'body':'ok'}}}
        self.assertEqual(compare(source,output,'qx',URL,fixture)['status'],'passed')
        rejected=[
            "function notify(opts={}){$notify('title','subtitle','body',opts)}notify($argument);$done({body:'ok'});",
            "function notify(opts={}){$notify('title','subtitle','body',opts)}notify();notify($argument);$done({body:'ok'});",
            "function notify(opts={}){$notify('title','subtitle','body',opts)}unknown(notify);notify();$done({body:'ok'});",
            "function notify(opts={}){$notify('title','subtitle','body',opts)}const alias=notify;notify();$done({body:'ok'});",
        ]
        for rejected_source in rejected:
            with self.subTest(source=rejected_source),self.assertRaises(ConversionError):
                convert_script(rejected_source,'Author',URL,'',source_format='qx')

    def test_unreachable_shared_wrapper_actual_is_ignored_only_with_closed_use_surface(self):
        source=("function send(opts){$task.fetch(opts).then(()=>{})}"
                "const api={get:opts=>send(opts),post:opts=>send(opts)};"
                "api.get({url:'https://example.test/'});$done({body:'ok'});")
        output=convert_script(source,'Author',URL,'',source_format='qx')
        self.assertIn('ctx.http',output)
        fixture={'name':'dead wrapper actual','request':{'url':URL},
                 'http':[{'url':'https://example.test/','status':200,'headers':{},'body':'network'}],
                 'expected':{'result':{'body':'ok'}}}
        self.assertEqual(compare(source,output,'qx',URL,fixture)['status'],'passed')
        rejected=[
            source.replace("api.get({url:'https://example.test/'});","api.get({url:'https://example.test/'});api.post($argument);"),
            source.replace("api.get({url:'https://example.test/'});","api.get({url:'https://example.test/'});unknown(api.post);"),
            source.replace("api.get({url:'https://example.test/'});","api.get({url:'https://example.test/'});unknown(api);"),
            source.replace("api.get({url:'https://example.test/'});","api.get({url:'https://example.test/'});unknown(api.get);"),
        ]
        for rejected_source in rejected:
            with self.subTest(source=rejected_source),self.assertRaises(ConversionError):
                convert_script(rejected_source,'Author',URL,'',source_format='qx')

    def test_published_http_member_read_keeps_shared_wrapper_actual(self):
        source=("function Env(name){return new class{"
                "constructor(name){this.http={get:req=>this.send(req,'GET'),post:req=>this.send(req,'POST')};}"
                "send(req,method){return new Promise((resolve,reject)=>{"
                "req=typeof req==='string'?{url:req}:req;req.method=method;"
                "$task.fetch(req).then(resp=>resolve(resp.body),reject);});}"
                "}(name)}"
                "const $=new Env('x');"
                "$.http.get({url:'https://example.test/'}).then(body=>$done({body}));")
        output=convert_script(source,'Author',URL,'',source_format='qx')
        fixture={'name':'published http member read','request':{'url':URL},
                 'http':[{'url':'https://example.test/','status':200,
                          'headers':{},'body':'network'}],
                 'expected':{'result':{'body':'network'}}}
        self.assertEqual(compare(source,output,'qx',URL,fixture)['status'],'passed')
        rejected=[
            source.replace("const $=new Env('x');","const $=new Env('x');$.http={get:req=>$,post:req=>{}};"),
            source.replace("const $=new Env('x');","const $=new Env('x');$.http=null;"),
            source.replace("const $=new Env('x');",
                           "const $=new Env('x');function make(){return {get:req=>$,post:req=>{}}}$.http=make();"),
        ]
        for rejected_source in rejected:
            with self.subTest(source=rejected_source),self.assertRaises(ConversionError):
                convert_script(rejected_source,'Author',URL,'',source_format='qx')
