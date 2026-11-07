"""Preserve the distinct rejection boundary of Promise.then(resolve, reject)."""
import unittest

from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.verify import compare

URL = 'https://example.test/task.js'


class TwoArgumentCompletionTests(unittest.TestCase):
    def check_case(self, source, body, writes=None):
        output = convert_script(source, 'Fixture', URL, '')
        case = {'name': 'two argument then', 'event_loop': True,
                'request': {'url': URL},
                'expected': {'result': {'body': body},
                             'events': {'storageWrites': writes or []}}}
        result = compare(source, output, 'surge', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_resolution_and_rejection_select_only_one_callback(self):
        for promise, expected in [("Promise.resolve('ok')", 'ok'),
                                  ("Promise.reject(new Error('offline'))", 'offline')]:
            with self.subTest(promise=promise):
                self.check_case(promise + ".then(value=>$done({body:value}),"
                                "error=>$done({body:error.message}));", expected)

    def test_fulfillment_throw_skips_paired_rejection_handler(self):
        self.check_case("async function task(){if($persistentStore.read('stop'))$done({});return 'ok'}"
                        "task().then(value=>{throw new Error('success threw')},"
                        "error=>$done({body:'wrong rejection'}))"
                        ".catch(error=>$done({body:error.message}));", 'success threw')

    def test_rejection_throw_reaches_downstream_catch(self):
        self.check_case("async function task(){if($persistentStore.read('stop'))$done({});throw new Error('offline')}"
                        "task().then(value=>$done({body:'wrong'}),"
                        "error=>{throw new Error('recovery threw')})"
                        ".catch(error=>$done({body:error.message}));", 'recovery threw')

    def test_noncompleting_callback_result_reaches_downstream_catch(self):
        self.check_case("Promise.resolve('ok').then(value=>{throw new Error(value)},"
                        "error=>error.message).catch(error=>$done({body:error.message}));", 'ok')

    def test_first_completion_skips_finalizer(self):
        for promise in ["Promise.resolve('ok')", "Promise.reject('ok')"]:
            with self.subTest(promise=promise):
                self.check_case(promise + ".then(value=>$done({body:value}),"
                                "error=>$done({body:error}))"
                                ".finally(()=>$persistentStore.write('late','key'));", 'ok')

    def test_named_callbacks_and_completing_receiver(self):
        self.check_case("function success(value){$done({body:value})}"
                        "function failure(error){$done({body:'wrong'})}"
                        "async function task(){await Promise.resolve();$done({body:'first'})}"
                        "task().then(success,failure);", 'first')

    def test_callback_return_and_recovery_are_awaited(self):
        for promise in ["Promise.resolve('ok')", "Promise.reject('ok')"]:
            self.check_case(promise + ".then(async value=>{await Promise.resolve();return value},"
                            "async error=>{await Promise.resolve();return error})"
                            ".finally(()=>$done({body:'finished'}));", 'finished')

    def test_qx_response_callback_can_read_native_body(self):
        source = "$task.fetch({url:'https://api.example'}).then(" \
                 "response=>$done({body:response.body}),error=>$done({body:'failed'}))" \
                 ".finally(()=>$persistentStore.write('late','key'));"
        output = convert_script(source, 'Fixture', URL, '', source_format='qx')
        case = {'name': 'two callback HTTP', 'request': {'url': URL},
                'http': [{'url': 'https://api.example', 'body': 'response'}],
                'expected': {'result': {'body': 'response'}}}
        result = compare(source, output, 'qx', URL, case)
        self.assertEqual(result['status'], 'passed', result)

    def test_receiver_creation_error_bypasses_promise_handlers(self):
        self.check_case("function boom(){throw new Error('synchronous')}"
                        "try {Promise.resolve(boom()).then(value=>$done({body:'wrong success'}),"
                        "error=>$done({body:'wrong rejection'}))"
                        ".catch(error=>$done({body:'wrong catch'})).finally(()=>{});}"
                        "catch(error){$done({body:error.message})}", 'synchronous')
