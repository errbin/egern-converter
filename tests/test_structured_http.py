"""HTTP callbacks share explicit structured completion with their callers."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare
from tools.egern_hub.convert import ConversionError

URL='https://example.test/callback.js'


class StructuredHTTPTests(unittest.TestCase):
    def test_finally_completion_in_direct_and_forwarded_callbacks(self):
        for forward in [False, True]:
            call='request' if forward else '$httpClient.get'
            source=('function request(o,c){$httpClient.get(o,c)}' if forward else '')+call+'''(
              {url:'https://example.test/api'},(e,r,b)=>{
                let output={body:'fallback'};
                try{output={body:e||b}}finally{$done(output)}
              });'''
            output=convert_script(source,'Fixture',URL,'')
            self.assertNotIn('$httpClient',output)
            for reply,body in [({'body':'changed'},'changed'),({'error':'offline'},'offline')]:
                case={'name':'HTTP finally','request':{'url':URL},
                      'http':[{'url':'https://example.test/api',**reply}],
                      'expected':{'result':{'body':body}}}
                result=compare(source,output,'surge',URL,case)
                self.assertEqual(result['status'],'passed',result)

    def test_completion_callback_cannot_escape_to_unknown_consumer(self):
        source='let value={};try{value={body:"changed"};unknown(()=>$done(value))}finally{}'
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')

    def test_unawaited_http_completion_does_not_skip_synchronous_finally(self):
        for forwarded in [False,True]:
            prefix='function request(o,c){$httpClient.get(o,c)}' if forwarded else ''
            call='request' if forwarded else '$httpClient.get'
            source=prefix+'''let value={body:'first'};
              try{CALL('https://example.test/api',(e,r,b)=>$done({body:b}))}
              finally{value={body:'synchronous'};$done(value)}'''.replace('CALL',call)
            with self.subTest(forwarded=forwarded),self.assertRaises(ConversionError):
                convert_script(source,'Fixture',URL,'')

    def test_http_completion_inside_unresolved_executor_is_rejected(self):
        source='''(async()=>{await new Promise(resolve=>{
          $httpClient.get('https://example.test/api',(e,r,b)=>{
            let value={};try{value={body:b}}finally{$done(value)}
          });
        })})();'''
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'')
