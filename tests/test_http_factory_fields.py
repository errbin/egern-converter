"""Native field projection keeps a closed factory's authored JavaScript flow."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/script.js'

# Independently authored reduced contract; no upstream library is vendored.
FACTORY = r"""
function createClient(defaults = {baseURL: ''}) {
  function dispatch(verb, options) {
    options = typeof options === 'string' ? {url: options} : options;
    if (defaults.baseURL && !/^https?:/.test(options.url)) options.url = defaults.baseURL + options.url;
    options = {...defaults, ...options};
    const hooks = {onRequest: () => {}, onResponse: r => r, onTimeout: () => {}, ...options.events};
    hooks.onRequest(verb, options);
    const work = new Promise((resolve, reject) => {
      $httpClient[verb.toLowerCase()](options, (error, response, body) => {
        if (error) reject(error);
        else resolve({body, status: response.status, headers: response.headers});
      });
    });
    const wait = options.timeout;
    let timer;
    const timed = wait ? Promise.race([work, new Promise((resolve, reject) => {
      timer = setTimeout(() => {hooks.onTimeout(); reject('deadline')}, wait);
    })]) : work;
    return timed.then(response => {clearTimeout(timer); return hooks.onResponse(response)});
  }
  const client = {};
  ['GET', 'POST'].forEach(verb => {client[verb.toLowerCase()] = options => dispatch(verb, options)});
  return client;
}
"""


class HTTPFactoryFieldTests(unittest.TestCase):
    def check_case(self, usage, requests, body='ok', platform='loon'):
        source = FACTORY + usage
        output = convert_script(source, 'Fixture', URL, '', source_format=platform)
        result = compare(source, output, platform, URL,
                         {'name': 'factory request fields', 'event_loop': True,
                          'request': {'url': URL}, 'http': requests,
                          'expected': {'result': {'body': body}}})
        self.assertEqual(result['status'], 'passed', result)
        for legacy in ['$httpClient', '$done', '$task']:
            self.assertNotIn(legacy, output)

    def test_string_url_and_base_url_keep_request_normalization(self):
        self.check_case("const http=createClient({baseURL:'https://api.example'});"
                        "http.get('/path').then(r=>$done({body:r.body})).finally(()=>{});",
                        [{'url': 'https://api.example/path', 'body': 'ok'}])

    def test_constructor_replacement_and_direct_factory_calls_keep_promises(self):
        for usage in [
                "let http=createClient();http=new createClient({baseURL:'https://api.example'});http.get('/path')",
                "createClient({baseURL:'https://api.example'}).get('/path')"]:
            self.check_case(usage + ".then(r=>$done({body:r.body})).finally(()=>{});",
                            [{'url': 'https://api.example/path', 'body': 'ok'}])

    def test_headers_body_and_default_merge_read_live_values(self):
        self.check_case("const http=createClient({baseURL:'',headers:{X:'default'},timeout:100});"
                        "const options={url:'https://api.example',body:'old',headers:{X:'new'}};"
                        "options.body='new';http.post(options).then(r=>$done({body:r.body}));",
                        [{'url': 'https://api.example', 'body': 'ok'}])

    def test_finite_dispatch_keeps_request_parameter_shape_and_evaluation(self):
        usage = """const http=createClient();let evaluations=0;
        const record={url:(evaluations++,'https://api.example'),body:'payload'};
        const verb=$persistentStore.read('verb')||'get';
        ((method,request)=>{
          if(method==='get')return http.get(request);
          if(method==='post')return http.post(request);
          throw new TypeError('unsupported');
        })(verb,record)
        .then(response=>$done({body:response.body+':'+evaluations}));"""
        self.check_case(usage, [{'url':'https://api.example','body':'ok'}], body='ok:1')

    def test_closed_request_builder_forwarders_keep_live_reassigned_records(self):
        source = FACTORY + '''
        function buildRequest(url, body) {
          const defaults = {'X-Fixture': 'yes'};
          const request = {url, headers: defaults, timeout: 1000, body};
          return request;
        }
        function forward(builder, url, body) { return builder(url, body); }
        const http = createClient();
        let request = forward(buildRequest, 'https://api.example', 'old');
        request = forward(buildRequest, 'https://api.example', 'payload');
        http.post(request).then(response => $done({body: response.body + ':' + request.body}));
        '''
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertNotIn('$httpClient', output)
        result = compare(source, output, 'loon', URL,
                         {'name': 'closed request builder', 'event_loop': True,
                          'request': {'url': URL},
                          'http': [{'url': 'https://api.example', 'body': 'ok'}],
                          'expected': {'result': {'body': 'ok:payload'},
                                       'events': {'requests': [{'method': 'POST', 'url': 'https://api.example',
                                                                'headers': {'x-fixture': 'yes'}, 'body': 'payload'}]}}})
        self.assertEqual(result['status'], 'passed', result)

    def test_builder_output_still_rejects_escaped_request_mutation(self):
        source = FACTORY + '''
        function buildRequest(url) { const request = {url}; return request; }
        const http = createClient();
        const request = buildRequest('https://api.example');
        foreign(request);
        http.get(request).then(response => $done({body: response.body}));
        '''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_dispatch_parameter_does_not_hide_mutation_or_escape(self):
        for change in ['foreign(request);', 'request=foreign();', 'request.unknown=true;']:
            source = FACTORY + "const http=createClient();((request)=>{" + change + \
                     "return http.get(request)})({url:'https://api.example'}).then(r=>$done({body:r.body}));"
            with self.subTest(change=change), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '', source_format='loon')

    def test_loon_top_level_accept_keeps_evaluation_without_inventing_header(self):
        self.check_case("let count=0;const http=createClient({baseURL:'',accept:(count++,'application/json')});"
                        "http.get('https://api.example').then(r=>$done({body:r.body+':'+count}));",
                        [{'url':'https://api.example','body':'ok'}],body='ok:1')
        source=FACTORY+"const http=createClient({accept:'application/json'});http.get('https://api.example').then(r=>$done({body:r.body}));"
        with self.assertRaises(ConversionError):convert_script(source,'Fixture',URL,'',source_format='surge')

    def test_transport_flags_are_proved_for_every_invocation(self):
        self.check_case("const http=createClient();"
                        "http.get({url:'https://api.example','auto-cookie':false}).then(r=>$done({body:r.body}));",
                        [{'url': 'https://api.example', 'body': 'ok'}])

    def test_rejection_and_authored_timeout_race_are_retained(self):
        usage = "const http=createClient();http.get({url:'https://api.example',timeout:100})" \
                ".then(r=>$done({body:r.body})).catch(error=>$done({body:error}));"
        source = FACTORY + usage
        output = convert_script(source, 'Fixture', URL, '', source_format='loon')
        self.assertIn('Promise.race', output)
        result = compare(source, output, 'loon', URL,
                         {'name': 'factory rejection', 'event_loop': True,
                          'request': {'url': URL},
                          'http': [{'url': 'https://api.example', 'error': 'offline'}],
                          'expected': {'result': {'body': 'offline'}}})
        self.assertEqual(result['status'], 'passed', result)

    def test_a_changed_factory_is_not_silently_assumed_reviewed(self):
        changed = FACTORY.replace('hooks.onRequest(verb, options);', 'unknown(options);')
        source = changed + "const http=createClient();http.get('https://api.example').then(r=>$done({body:r.body}));"
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')

    def test_unknown_hook_or_mutator_or_transport_field_is_rejected(self):
        for options, extra in [
                ("{url:'https://api.example',events:{onRequest:(method,options)=>external(options)}}", ''),
                ("{url:'https://api.example',unknown:true}", ''),
                ("{url:'https://api.example'}", 'foreign.get(options);'),
                ("{url:'https://api.example'}", 'const alias=options;alias.extra=true;'),
                ("{...'https://api.example'}", ''),
                ("{url:'https://api.example'}", 'options[external()]=true;')]:
            source = FACTORY + 'const http=createClient();const options=' + options + ';' + extra \
                     + 'http.get(options).then(r=>$done({body:r.body}));'
            with self.subTest(options=options, extra=extra), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')

    def test_conditional_transport_overwrite_does_not_become_a_constant(self):
        source = FACTORY + "const http=createClient();const options={url:'https://api.example','auto-cookie':true};" \
                 "if($persistentStore.read('change'))options['auto-cookie']=false;" \
                 "http.get(options).then(r=>$done({body:r.body}));"
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')
