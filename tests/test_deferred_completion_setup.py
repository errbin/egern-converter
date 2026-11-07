"""Root completion chains retain synchronous prototype initialization order."""
import unittest
from tools.egern_hub.script_convert import convert_script
from tools.egern_hub.convert import ConversionError
from tools.egern_hub.verify import compare

URL = 'https://example.test/deferred.js'

class DeferredCompletionSetupTests(unittest.TestCase):
    def check(self, source, expected):
        native = convert_script(source, 'Fixture', URL, '')
        result = compare(source, native, 'surge', URL, {
            'name': 'ordered prototype setup', 'request': {'url': URL},
            'expected': {'result': {'body': expected}},
        })
        self.assertEqual(result['status'], 'passed', result)

    def test_root_chain_starts_before_setup_and_resumes_after_setup(self):
        self.check('let before; (async()=>{before=typeof Date.prototype.fixtureFormat;await Promise.resolve();return new Date().fixtureFormat()})().then(v=>$done({body:before+":"+v}));Date.prototype.fixtureFormat=function(){return "ready"};', 'undefined:ready')

    def test_branch_without_braces_keeps_else_association(self):
        for flag, expected in [('true', 'ready'), ('false', 'other')]:
            self.check('if('+flag+') Promise.resolve().then(()=>$done({body:new Date().fixtureFormat()}));else $done({body:"other"});Date.prototype.fixtureFormat=function(){return "ready"};', expected)

    def test_synchronous_completion_skips_setup(self):
        self.check('(async()=>{$done({body:"early"})})().then(()=>{throw Error("late")});Date.prototype.fixtureFormat=function(){return "ready"};', 'early')

    def test_scalar_initialization_after_launch_keeps_start_and_resume_order(self):
        self.check('(async()=>{const before=hexcase;await Promise.resolve();return String(before)+":"+hexcase})().then(v=>$done({body:v}));var hexcase=0;', 'undefined:0')
        self.check('if(true) Promise.resolve().then(()=>$done({body:String(flag)}));else $done({body:"other"});const flag=3;', '3')
        self.check('(async()=>{$done({body:"early"})})().then(()=>{throw Error("late")});let flag=3;', 'early')

    def test_last_sequence_item_forwards_async_completion(self):
        self.check('function dispatch(v){(0,finish(v));}async function finish(v){await Promise.resolve();try{throw Error(v)}catch(e){$done({body:e.message})}}dispatch("kept");', 'kept')
        with self.assertRaises(ConversionError):
            convert_script('function dispatch(){(finish(),unknown());}async function finish(){await Promise.resolve();try{throw Error("x")}catch(e){$done({body:e.message})}}dispatch();', 'Fixture', URL, '')

    def test_unknown_setup_or_prototype_observation_is_not_deferred(self):
        cases = [
            'const p=Date.prototype;unknown(p);Promise.resolve().then(()=>$done({}));Date.prototype.fixtureFormat=function(){};',
            'Date.prototype.fixtureFormat=unknown;Promise.resolve().then(()=>$done({}));Date.prototype.fixtureFormat=function(){};',
            'Promise.resolve().then(()=>$done({}));unknown();Date.prototype.fixtureFormat=function(){};',
            'Promise.resolve().then(()=>$done({}));Object.defineProperty(Date.prototype,"fixtureFormat",{set(v){throw Error("setter")}});Date.prototype.fixtureFormat=function(){};',
            'Promise.resolve().then(()=>$done({}));Date.prototype.fixtureFormat=unknown;',
            'Promise.resolve().then(()=>$done({}));Date.prototype.toString=function(){return "changed"};',
            'Promise.resolve().then(()=>$done({}));Promise.resolve().then(()=>$done({}));Date.prototype.fixtureFormat=function(){};',
        ]
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ConversionError):
                convert_script(source, 'Fixture', URL, '')
