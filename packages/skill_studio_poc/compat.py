"""The fixed Demo loader's YAML 1.2-like boolean behavior, used only as a check.

This is not a round-trip editor. It deliberately rejects duplicate map keys.
"""
from copy import deepcopy
import re
import yaml


class DemoYaml12Loader(yaml.SafeLoader):
    yaml_implicit_resolvers = deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)


for initial, resolvers in DemoYaml12Loader.yaml_implicit_resolvers.items():
    DemoYaml12Loader.yaml_implicit_resolvers[initial] = [
        (tag, regexp) for tag, regexp in resolvers if tag != 'tag:yaml.org,2002:bool'
    ]
DemoYaml12Loader.add_implicit_resolver(
    'tag:yaml.org,2002:bool', re.compile(r'^(?:true|false)$', re.I), list('tTfF')
)


def _unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if key in result:
            raise yaml.constructor.ConstructorError(None, None, f'duplicate mapping key: {key}', key_node.start_mark)
        result[key] = loader.construct_object(value_node, deep=True)
    return result


DemoYaml12Loader.add_constructor('tag:yaml.org,2002:map', _unique_mapping)


def load_demo_yaml(text: str):
    return yaml.load(text, Loader=DemoYaml12Loader)
