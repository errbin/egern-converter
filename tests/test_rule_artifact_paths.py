import unittest

from tools.egern_hub.layout import artifact_path, assign_rule_outputs


# 规则集公开路径属于站点发布契约，进入阻塞的 site 测试域。
CI_DOMAIN = 'site'


def rule(identifier, owner, repo, name, *, subdir='data'):
    return {
        'id': identifier,
        'kind': 'rules',
        'format': 'v2fly-domain-list',
        'repository': f'https://github.com/{owner}/{repo}',
        'url': f'https://raw.githubusercontent.com/{owner}/{repo}/main/{subdir}/{name}',
    }


def paths(items):
    return {item['id']: artifact_path(item, 'rules') for item in items}


class RuleArtifactPathTests(unittest.TestCase):
    def test_single_source_flattens_to_basename(self):
        items = [rule('one', 'Owner', 'Repo', 'elevenlabs')]
        assign_rule_outputs(items)
        self.assertEqual(paths(items), {'one': 'rules/elevenlabs.yaml'})
        self.assertEqual(items[0]['output'], 'elevenlabs.yaml')

    def test_same_name_from_different_owners_uses_owner_suffix(self):
        items = [
            rule('one', 'Alpha', 'First', 'shared'),
            rule('two', 'Beta', 'Second', 'shared'),
        ]
        assign_rule_outputs(items)
        self.assertEqual(paths(items), {
            'one': 'rules/shared-alpha.yaml',
            'two': 'rules/shared-beta.yaml',
        })

    def test_same_owner_different_repositories_add_repository_suffix(self):
        items = [
            rule('one', 'Alpha', 'First', 'shared'),
            rule('two', 'Alpha', 'Second', 'shared'),
        ]
        assign_rule_outputs(items)
        self.assertEqual(paths(items), {
            'one': 'rules/shared-alpha-first.yaml',
            'two': 'rules/shared-alpha-second.yaml',
        })

    def test_conflict_detection_is_case_insensitive(self):
        items = [
            rule('one', 'Alpha', 'First', 'Shared'),
            rule('two', 'Beta', 'Second', 'shared'),
        ]
        assign_rule_outputs(items)
        self.assertEqual(paths(items), {
            'one': 'rules/Shared-alpha.yaml',
            'two': 'rules/shared-beta.yaml',
        })
        self.assertEqual(len({path.casefold() for path in paths(items).values()}), 2)

    def test_adding_a_same_name_source_does_not_move_unrelated_paths(self):
        unrelated = rule('other', 'Other', 'Repo', 'unrelated')
        initial = [rule('one', 'Alpha', 'First', 'shared'), unrelated]
        assign_rule_outputs(initial)
        self.assertEqual(paths(initial), {
            'one': 'rules/shared.yaml',
            'other': 'rules/unrelated.yaml',
        })

        expanded = [rule('one', 'Alpha', 'First', 'shared'),
                    rule('two', 'Beta', 'Second', 'shared'), unrelated]
        assign_rule_outputs(expanded)
        self.assertEqual(paths(expanded), {
            'one': 'rules/shared-alpha.yaml',
            'two': 'rules/shared-beta.yaml',
            'other': 'rules/unrelated.yaml',
        })

        # 同名来源继续增加时，不会改动其他 owner 已稳定下来的路径。
        expanded.append(rule('three', 'Beta', 'Third', 'shared'))
        assign_rule_outputs(expanded)
        self.assertEqual(paths(expanded), {
            'one': 'rules/shared-alpha.yaml',
            'two': 'rules/shared-beta-second.yaml',
            'three': 'rules/shared-beta-third.yaml',
            'other': 'rules/unrelated.yaml',
        })

    def test_unresolvable_conflict_fails_with_the_conflicting_items(self):
        items = [
            rule('one', 'Alpha', 'Repo', 'shared', subdir='one'),
            rule('two', 'Alpha', 'Repo', 'shared', subdir='two'),
        ]
        with self.assertRaisesRegex(ValueError, r'规则集产物路径无法消解.*one.*two'):
            assign_rule_outputs(items)

    def test_non_ascii_owner_is_transliterated_and_modules_keep_repository_paths(self):
        items = [
            rule('one', '作者', '第一仓库', 'shared'),
            rule('two', 'Beta', 'Second', 'shared'),
        ]
        assign_rule_outputs(items)
        self.assertEqual(paths(items), {
            'one': 'rules/shared-zuozhe.yaml',
            'two': 'rules/shared-beta.yaml',
        })
        module = {'id': 'demo', 'kind': 'modules', 'repository': 'https://github.com/Alpha/First',
                  'url': 'https://raw.githubusercontent.com/Alpha/First/main/apps/demo.sgmodule'}
        script = {'id': 'demo-script', 'kind': 'scripts', 'repository': 'https://github.com/Alpha/First',
                  'url': 'https://raw.githubusercontent.com/Alpha/First/main/js/demo.js'}
        self.assertEqual(artifact_path(module), 'modules/Alpha/First/apps/demo.yaml')
        self.assertEqual(artifact_path(script), 'scripts/Alpha/First/js/demo.js')


if __name__ == '__main__':
    unittest.main()
