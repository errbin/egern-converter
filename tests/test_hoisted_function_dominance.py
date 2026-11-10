"""重复 function 声明的支配证明必须双向成立：全部 hoisted 才放行，混入变量声明或提前调用仍拒绝。"""
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
FOLD = ROOT / 'tests/helpers/hoisted-env-fold.mjs'
FIXTURE = (ROOT / 'tests/helpers/hoisted-function-env.js').read_text()


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


class HoistedFunctionDominanceTests(unittest.TestCase):

    def test_duplicate_hoisted_declarations_allow_environment_folding(self):
        data = fold(FIXTURE)
        self.assertNotIn('error', data)
        self.assertTrue(data['folded'])
        self.assertEqual(data['require'], 0)
        self.assertIn("$done({ name: this.name })", data['source'])

    def test_early_call_before_instance_declaration_still_rejects(self):
        changed = FIXTURE.replace("const $ = new Env('fixture');", "main();\nconst $ = new Env('fixture');", 1)
        self.assertNotEqual(changed, FIXTURE)
        data = fold(changed)
        self.assertFalse(data['folded'])
        self.assertGreaterEqual(data['require'], 1)

    def test_variable_declaration_mixed_with_hoisted_function_still_rejects(self):
        before = "async function main() {\n  await sign();\n}\nasync function main() {\n  await sign();\n}"
        after = "var main = async function () {\n  await sign();\n};\nasync function main() {\n  await sign();\n}"
        changed = FIXTURE.replace(before, after, 1)
        self.assertNotEqual(changed, FIXTURE)
        data = fold(changed)
        self.assertFalse(data['folded'])
        self.assertGreaterEqual(data['require'], 1)

    def test_block_scoped_duplicate_declaration_still_rejects(self):
        before = "async function main() {\n  await sign();\n}"
        after = "{\n  async function main() {\n    await sign();\n  }\n}\nasync function main() {\n  await sign();\n}"
        changed = FIXTURE.replace(before, after, 1)
        self.assertNotEqual(changed, FIXTURE)
        data = fold(changed)
        self.assertFalse(data['folded'])
        self.assertGreaterEqual(data['require'], 1)

    def test_binding_write_still_rejects(self):
        changed = FIXTURE + "main = function () {};\n"
        data = fold(changed)
        self.assertFalse(data['folded'])
        self.assertGreaterEqual(data['require'], 1)


if __name__ == '__main__':
    unittest.main()
