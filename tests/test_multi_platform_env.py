"""多平台 Env 结构判据必须双向成立：封闭形态可折叠，任一成员破坏封闭性即整族拒绝。"""
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
FOLD = ROOT / 'tests/helpers/multi-platform-env.mjs'

CLASS_FIXTURE = '''function Env(name) {
  return new class {
    constructor(name) { this.name = name; }
    getEnv() {
      return typeof $environment !== 'undefined' && $environment['surge-version'] ? 'Surge'
        : typeof $task !== 'undefined' ? 'Quantumult X' : 'Node.js';
    }
    isNode() { return this.getEnv() === 'Node.js'; }
    getdata(key) {
      if (this.isNode()) return require('fs').readFileSync(key, 'utf8');
      return $persistentStore.read(key);
    }
    done(value) {
      if (this.isNode()) require('fs').writeFileSync('x', 'y');
      else $done(value);
    }
  }(name);
}
const runtime = new Env('fixture');
runtime.done({body: runtime.getdata('key')});
'''

PROTOTYPE_FIXTURE = '''function Env(name) { this.name = name; }
Env.prototype.getEnv = function () {
  return typeof $environment !== 'undefined' && $environment['surge-version'] ? 'Surge'
    : typeof $task !== 'undefined' ? 'Quantumult X' : 'Node.js';
};
Env.prototype.isNode = function () { return this.getEnv() === 'Node.js'; };
Env.prototype.getdata = function (key) {
  if (this.isNode()) return require('fs').readFileSync(key, 'utf8');
  return $persistentStore.read(key);
};
Env.prototype.done = function (value) {
  if (this.isNode()) require('fs').writeFileSync('x', 'y');
  else $done(value);
};
const runtime = new Env('fixture');
runtime.done({body: runtime.getdata('key')});
'''


def fold(source):
    result = subprocess.run(
        ['node', str(FOLD)],
        input=source,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


class MultiPlatformEnvTests(unittest.TestCase):
    def assert_folded(self, source, *, normalized=False):
        data = fold(source)
        self.assertNotIn('error', data)
        if normalized:
            self.assertGreater(data['normalized'], 0)
        self.assertGreater(data['folded'], 0)
        self.assertNotIn('this.getEnv(', data['stages']['fold']['source'])
        self.assertNotIn('this.isNode(', data['stages']['fold']['source'])
        self.assertEqual(data['stages']['prune']['counts']['require'], 0)
        self.assertGreater(data['stages']['prune']['counts']['persistentStore'], 0)
        self.assertGreater(data['stages']['prune']['counts']['done'], 0)

    def assert_unknown(self, source, *, normalized=False):
        data = fold(source)
        self.assertNotIn('error', data)
        if normalized:
            self.assertGreater(data['normalized'], 0)
        self.assertEqual(data['folded'], 0)
        self.assertGreater(data['stages']['fold']['counts']['isNode'], 0)
        self.assertGreater(data['stages']['fold']['counts']['require'], 0)

    def test_closed_class_factory_folds_platform_and_node_branches(self):
        self.assert_folded(CLASS_FIXTURE)

    def test_closed_prototype_factory_is_normalized_before_folding(self):
        self.assert_folded(PROTOTYPE_FIXTURE, normalized=True)

    def test_instance_escape_rejects_the_whole_factory(self):
        self.assert_unknown(CLASS_FIXTURE + 'use(runtime);\n')

    def test_one_escaping_instance_rejects_all_instances(self):
        changed = CLASS_FIXTURE.replace(
            "runtime.done({body: runtime.getdata('key')});",
            "runtime.done({body: runtime.getdata('key')});const other=new Env('other');use(other);",
        )
        self.assertNotEqual(changed, CLASS_FIXTURE)
        self.assert_unknown(changed)

    def test_method_write_and_binding_write_are_rejected(self):
        for suffix in ["runtime.done = () => {};", "runtime = new Env('changed');"]:
            with self.subTest(suffix=suffix):
                self.assert_unknown(CLASS_FIXTURE + suffix + '\n')

    def test_dynamic_this_member_is_rejected(self):
        changed = CLASS_FIXTURE.replace(
            "return this.getEnv() === 'Node.js';",
            "return this['get' + 'Env']() === 'Node.js';",
        )
        self.assertNotEqual(changed, CLASS_FIXTURE)
        self.assert_unknown(changed)

    def test_ambiguous_probe_contract_rejects_the_family(self):
        changed = CLASS_FIXTURE.replace(
            "isNode() { return this.getEnv() === 'Node.js'; }",
            "isNode() { return this.getEnv() === 'Node.js'; }\n"
            "isBrowser() { return typeof window !== 'undefined' ? 'Surge' : 'Node.js'; }",
        )
        self.assertNotEqual(changed, CLASS_FIXTURE)
        self.assert_unknown(changed)

    def test_probe_arguments_and_non_probe_parameters_are_rejected(self):
        changed = CLASS_FIXTURE.replace('getEnv() {', 'getEnv(flag) {')
        self.assertNotEqual(changed, CLASS_FIXTURE)
        self.assert_unknown(changed)

    def test_prototype_escape_duplicate_and_arrow_methods_are_rejected(self):
        variants = [
            PROTOTYPE_FIXTURE.replace("const runtime = new Env('fixture');", "use(Env.prototype);const runtime = new Env('fixture');"),
            PROTOTYPE_FIXTURE.replace(
                "Env.prototype.isNode = function () { return this.getEnv() === 'Node.js'; };",
                "Env.prototype.isNode = function () { return this.getEnv() === 'Node.js'; };\n"
                "Env.prototype.isNode = function () { return false; };",
            ),
            PROTOTYPE_FIXTURE.replace(
                "Env.prototype.isNode = function () { return this.getEnv() === 'Node.js'; };",
                "Env.prototype.isNode = () => this.getEnv() === 'Node.js';",
            ),
        ]
        for changed in variants:
            with self.subTest():
                self.assertNotEqual(changed, PROTOTYPE_FIXTURE)
                self.assert_unknown(changed)

    def test_prototype_factory_with_constructor_return_is_rejected(self):
        changed = PROTOTYPE_FIXTURE.replace('function Env(name) { this.name = name; }', 'function Env(name) { return {}; }')
        self.assertNotEqual(changed, PROTOTYPE_FIXTURE)
        data = fold(changed)
        self.assertEqual(data['normalized'], 0)
        self.assertEqual(data['folded'], 0)

    def test_prototype_instance_method_value_escape_rejects_normalization(self):
        changed = PROTOTYPE_FIXTURE.replace(
            "runtime.done({body: runtime.getdata('key')});",
            "const read=runtime.getdata;runtime.done({body:read('key')});",
        )
        self.assertNotEqual(changed, PROTOTYPE_FIXTURE)
        data = fold(changed)
        self.assertEqual(data['normalized'], 0)
        self.assertEqual(data['folded'], 0)

    def test_prototype_nested_return_and_arguments_reflection_reject_normalization(self):
        variants = [
            PROTOTYPE_FIXTURE.replace(
                'function Env(name) { this.name = name; }',
                'function Env(name) { if (name) return {}; this.name = name; }',
            ),
            PROTOTYPE_FIXTURE.replace(
                'function Env(name) { this.name = name; }',
                'function Env(name) { this.callee = arguments.callee; this.name = name; }',
            ),
        ]
        for changed in variants:
            with self.subTest():
                self.assertNotEqual(changed, PROTOTYPE_FIXTURE)
                data = fold(changed)
                self.assertEqual(data['normalized'], 0)
                self.assertEqual(data['folded'], 0)

    def test_default_parameter_is_evaluated_only_in_the_normalized_constructor(self):
        changed = PROTOTYPE_FIXTURE.replace(
            'function Env(name) { this.name = name; }',
            'function Env(name = mark()) { this.name = name; }',
        )
        self.assertNotEqual(changed, PROTOTYPE_FIXTURE)
        data = fold(changed)
        self.assertGreater(data['normalized'], 0)
        self.assertEqual(data['stages']['normalize']['source'].count('mark()'), 1)


if __name__ == '__main__':
    unittest.main()
