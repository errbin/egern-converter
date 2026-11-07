"""Closed accessors/arguments and copied request records retain source behavior."""
import unittest
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_scripts
from tools.egern_hub.verify import compare, execute

URL='https://example.test/accessors.js'
FACTORY='''function Factory(name){return new class{
 constructor(){this.name=name;this.level='start'}
 set level(value){this._level=value.toUpperCase()}
 get level(){return this._level}
 get request(){return typeof $request==='undefined'?undefined:$request}
 message(value='default'){return arguments.length+':'+String(arguments[0])+':'+value+':'+this.level+':'+this.request.url}
}}'''

def compile_source(source):
    return convert_scripts([{'id':'test','url':URL,'source':source,'source_format':'loon','author':'Fixture','license_text':'','entry_types':['http_request']}])['test']

class ClosedAccessorTests(unittest.TestCase):
    def equivalent(self,source,**extra):
        output=compile_source(source)
        case={'name':'accessor','request':{'url':URL},**extra}
        result=compare(source,output,'loon',URL,case)
        self.assertEqual(result['status'],'passed',result)
        self.assertNotRegex(output,r'\$(?:done|request|response|notification|httpClient)\b')
        return output

    def test_getters_setters_assignment_value_arguments_and_defaults(self):
        for call in ['r.message()','r.message(undefined)','r.message("explicit")']:
            source='const r=Factory("Fixture");const assigned=(r.level="info");$done({body:assigned+":"+'+call+'});'+FACTORY
            self.equivalent(source)

    def test_receiver_escape_readonly_assignment_and_mutation_still_fail(self):
        for entry in ['const r=Factory("x");unknown(r);$done({});',
                      'const r=Factory("x");r.request={};$done({});',
                      'const r=Factory("x");delete r.level;$done({});',
                      'const r=Factory("x");r.level++;$done({});']:
            with self.subTest(entry=entry),self.assertRaises(ConversionError):compile_source(entry+FACTORY)
        for change in ['observe(this);this.name=name','this.name=name;Object.keys(this)']:
            source='const r=Factory("x");$done({body:r.message()});'+FACTORY.replace('this.name=name',change)
            with self.subTest(change=change),self.assertRaises(ConversionError):compile_source(source)

    def test_returned_request_copy_preserves_header_changes(self):
        source='''function copy(input){const result=Object.assign({},input);if($argument)result.headers={"X-Fixture":"changed"};return result}
        const request=copy({url:'https://api.example.test/',headers:{'X-Fixture':'original'},body:'hello'});
        $httpClient.post(request,(error,response,body)=>$done({body}));'''
        for argument in ['', 'change']:
            self.equivalent(source,argument=argument,http=[{'body':'response'}])

    def test_copied_flags_unknown_fields_and_aliases_are_not_inferred(self):
        for mutation in ['if($argument)result["auto-redirect"]=false',
                         'unknown(result)', 'result[$argument]=1']:
            source='''function copy(input){const result=Object.assign({},input);'''+mutation+''';return result}
            const request=copy({url:'https://api.example.test/',"auto-redirect":true});
            $httpClient.get(request,(e,r,b)=>$done({body:b}));'''
            with self.subTest(mutation=mutation),self.assertRaises(ConversionError):compile_source(source)

    def test_returned_notification_records_and_assignment_order(self):
        source='''function options(value){let result={};if(value)result={openUrl:'https://example.test/'};else result.mediaUrl='https://example.test/a.png';return result}
        let option='';if(option=options($argument),$argument)$notification.post('T','','B',option);else $notification.post('T','','B',option);$done({});'''
        for argument in ['', 'yes']:self.equivalent(source,argument=argument)

    def test_strict_implicit_loop_variables_are_not_repaired(self):
        for loop in ['for(key of [1]){}','for(key in {a:1}){}']:
            source='"use strict";'+loop+'$done({});'
            output=compile_source(source)
            self.assertNotRegex(output,r'for\s*\(\s*(?:let|var|const)\s+key')
            case={'name':'strict loop','request':{'url':URL}}
            for side,code in [('original',source),('converted',output)]:
                self.assertIn('error',execute(code,'loon',URL,case,side))
        with self.assertRaises(ConversionError):compile_source('"use strict";for(key=0;key<1;key++){}$done({});')

    def test_batch_accepts_a_generator_of_jobs(self):
        item={'id':'test','url':URL,'source':'$done({body:"ok"});','author':'Fixture','license_text':''}
        self.assertIn('test',convert_scripts(iter([item])))

    def test_class_strict_assignments_are_not_localized_after_flattening(self):
        source='const r=Factory();r.done();function Factory(){return new class{constructor(){implicitClassValue=1}done(){$done({})}}}'
        with self.assertRaisesRegex(ConversionError,'隐式全局'):compile_source(source)

if __name__=='__main__':unittest.main()
