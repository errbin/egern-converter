"""A QX response-filter option does not run in callback HTTP clients."""
import unittest

from tools.egern_hub.convert import ConversionError
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare, execute

URL = 'https://example.test/filter.js'


class PlatformHTTPOptionsTests(unittest.TestCase):
    def test_qx_http_defaults_and_explicit_options_keep_qx_semantics(self):
        source = '''(async()=>{const response=await $task.fetch({url:'https://example.test/api'});
$done({body:response.body});})();'''
        for format in ('qx',):
            with self.subTest(format=format, mode='omitted'):
                output = convert_script(source, 'Fixture', URL, '', source_format=format)
                case = {'name': 'QX omitted HTTP options', 'request': {'url': URL},
                        'http': [{'url': 'https://example.test/api', 'body': 'ok'}]}
                result = compare(source, output, format, URL, case)
                self.assertEqual(result['status'], 'passed', result)
                for side, code in [('original', source), ('converted', output)]:
                    observed = execute(code, format, URL, case, side)
                    request = observed['observation']['events']['requests'][0]
                    self.assertNotIn('timeout', request)
                    self.assertIs(request['insecureTls'], False)
                    self.assertEqual(request['credentials'], 'omit')

        explicit = source.replace(
            "{url:'https://example.test/api'}",
            "{url:'https://example.test/api',timeout:2,opts:{'auto-cookie':true,"
            "'skip-cert-verify':true,redirection:false}}")
        with self.subTest(format='qx', mode='explicit'):
            output = convert_script(explicit, 'Fixture', URL, '', source_format='qx')
            case = {'name': 'QX explicit HTTP options', 'request': {'url': URL},
                    'http': [{'url': 'https://example.test/api', 'body': 'ok'}]}
            result = compare(explicit, output, 'qx', URL, case)
            self.assertEqual(result['status'], 'passed', result)
            for side, code in [('original', explicit), ('converted', output)]:
                observed = execute(code, 'qx', URL, case, side)
                request = observed['observation']['events']['requests'][0]
                self.assertEqual(request['timeout'], 2)
                self.assertIs(request['insecureTls'], True)
                self.assertEqual(request['credentials'], 'include')
                self.assertEqual(request['redirect'], 'manual')

    def test_non_qx_http_defaults_are_unchanged(self):
        source = '''$httpClient.get({url:'https://example.test/api'},
(error,response,body)=>$done({body}));'''
        for platform in ('surge', 'loon', 'stash', 'shadowrocket'):
            with self.subTest(platform=platform):
                output = convert_script(source, 'Fixture', URL, '', source_format=platform)
                case = {'name': 'non-QX HTTP defaults', 'request': {'url': URL},
                        'http': [{'url': 'https://example.test/api', 'body': 'ok'}]}
                result = compare(source, output, platform, URL, case)
                self.assertEqual(result['status'], 'passed', result)
                for side, code in [('original', source), ('converted', output)]:
                    observed = execute(code, platform, URL, case, side)
                    request = observed['observation']['events']['requests'][0]
                    self.assertEqual(request['timeout'], 5000)
                    self.assertNotIn('insecureTls', request)
                    self.assertEqual(request['credentials'], 'include')

    def test_qx_live_request_can_merge_static_opts_before_dispatch(self):
        # QX 记录可以在发送前把静态选项合并进 req.opts；实时请求路径必须
        # 保留这些字段，而不是因为记录被修改就退回静态对象证明。
        source = '''function send(req){req.headers&&delete req.headers['X-Drop'];
req.opts=req.opts||{};Object.assign(req.opts,{redirection:false,'auto-cookie':true,
'skip-cert-verify':true,policy:'direct',hints:false});
$task.fetch(req).then(r=>$done({body:r.body}));}
send({url:'https://example.test/api'});'''
        output = convert_script(source, 'Fixture', URL, '', source_format='qx')
        case = {'name': 'QX merged opts', 'request': {'url': URL},
                'http': [{'url': 'https://example.test/api', 'body': 'ok'}]}
        result = compare(source, output, 'qx', URL, case)
        self.assertEqual(result['status'], 'passed', result)
        for side, code in [('original', source), ('converted', output)]:
            observed = execute(code, 'qx', URL, case, side)
            request = observed['observation']['events']['requests'][0]
            self.assertEqual(request['redirect'], 'manual')
            self.assertEqual(request['credentials'], 'include')
            self.assertIs(request['insecureTls'], True)
            self.assertEqual(request['policy'], 'direct')

    def test_qx_live_opts_merge_rejects_dynamic_or_unknown_fields(self):
        # 实时 opts 投影只接受可静态枚举的已适配键；动态键、未知来源和
        # 未知字段都必须保持拒绝，不能用“字段原本缺席”绕过证明。
        base = ("function send(req){req.opts=req.opts||{};MUTATION"
                "$task.fetch(req).then(r=>$done({body:r.body}));}"
                "send({url:'https://example.test/api'});")
        variants = [
            "Object.assign(req.opts,{[key]:false});",
            "Object.assign(req.opts,JSON.parse('{}'));",
            "Object.assign(req.opts,{filter:'x'});",
        ]
        for mutation in variants:
            with self.subTest(mutation=mutation), self.assertRaises(ConversionError):
                convert_script(base.replace('MUTATION', mutation), 'Fixture', URL, '',
                               source_format='qx')

    def test_callback_clients_keep_raw_body_in_shared_option_records(self):
        source = '''const options={url:'https://example.test/api',
opts:{filter:'throw new Error("QX-only filter must not execute")'}};
$httpClient.get(options,(error,response,body)=>$done({body}));'''
        for platform in ['surge', 'loon', 'stash', 'shadowrocket']:
            with self.subTest(platform=platform):
                output = convert_script(source, 'Fixture', URL, '', source_format=platform)
                case = {'name': 'callback body bypasses QX filter',
                        'request': {'url': URL},
                        'http': [{'url': 'https://example.test/api', 'body': 'unfiltered'}],
                        'expected': {'result': {'body': 'unfiltered'}}}
                result = compare(source, output, platform, URL, case)
                self.assertEqual(result['status'], 'passed', result)
                self.assertIn('ctx.http.get(', output)
                self.assertNotIn('$httpClient', output)

    def test_unknown_dynamic_effectful_and_mutated_options_are_rejected(self):
        for value in ['{unknown:true}', '{filter:unknown}',
                      '{get filter(){return "body"}}',
                      '{filter:sideEffect()}', '{[sideEffect()]:"body"}']:
            source = ('const options={url:"https://example.test/api",opts:' + value + '};'
                      '$httpClient.get(options,(e,r,b)=>$done({body:b}));')
            with self.subTest(value=value), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')
        source = '''const opts={filter:'return body'};opts.filter='changed';
$httpClient.get({url:'https://example.test/api',opts},(e,r,b)=>$done({body:b}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '')
        for use in ['unknown(opts);', 'const alias=opts;alias.filter="changed";']:
            source = ('const opts={filter:"return body"};' + use +
                      '$httpClient.get({url:"https://example.test/api",opts},(e,r,b)=>$done({body:b}));')
            with self.subTest(use=use), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')

    def test_qx_filter_cannot_be_silently_discarded(self):
        source = '''$task.fetch({url:'https://example.test/api',
opts:{filter:'return body.toUpperCase()'}}).then(r=>$done({body:r.body}));'''
        with self.assertRaises(ConversionError):
            convert_script(source, 'Fixture', URL, '', source_format='qx')
