"""Recognize personal disputes and slogans, independent of specific identities."""
import re

EDITORIAL = re.compile(r'傻[逼比]|煞笔|无耻|人品不行|偷(?:别人|他人)?(?:的)?(?:规则|脚本)|抄袭|到处抄|抄规则|赶紧来偷|为人(?:正直|奸诈)|真(?:君子|小人)')


def is_editorial(value):
    return bool(EDITORIAL.search(value))


def is_administrative_heading(value):
    """A whole status/category label is not an app name or behavior note."""
    compact = re.sub(r'[\s#＃>：:，,、/|·—–_-]+', '', value)
    return bool(re.fullmatch(r'(?:(?:分流|规则)(?:修正|修复|调整|更新|新增|补充)?)(?:(?:修正|修复|调整|更新|新增|补充))*', compact))
