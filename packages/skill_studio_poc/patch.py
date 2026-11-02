"""Source-preserving YAML Patch POC. No code execution or filesystem writes.

The ruamel CST is used for *source locations and validation*, never for
serializing a whole Skill. Edits are exact text spans, then parsed again.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from collections.abc import Mapping
import difflib
import json
import re

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap
from ruamel.yaml.scalarstring import LiteralScalarString, FoldedScalarString


class PatchRejected(ValueError):
    """The source revision, syntax, or semantic precondition is not safe."""


_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
_VERIFY_OUTCOMES = frozenset({"PASS", "FAIL", "UNKNOWN"})
_CREATE_OUTCOMES = frozenset({"COMMITTED", "NOT_COMMITTED", "OUTCOME_UNKNOWN", "FAILED", "DENIED"})
_RECONCILE_OUTCOMES = frozenset({"COMMITTED", "NOT_COMMITTED", "UNRESOLVED", "FAILED", "DENIED"})


def _yaml() -> YAML:
    parser = YAML(typ="rt")
    parser.preserve_quotes = True
    parser.allow_duplicate_keys = False
    # YAML 1.2 implicit resolution is ruamel's default. In particular 'on'
    # is a string, unlike PyYAML's unmodified YAML 1.1 SafeLoader.
    return parser


def _parse(text: str) -> CommentedMap:
    try:
        tree = _yaml().load(text)
    except Exception as exc:
        raise PatchRejected(f"YAML parse failed: {exc}") from exc
    if not isinstance(tree, CommentedMap):
        raise PatchRejected("Skill Procedure source must be a YAML mapping")
    return tree


def revision(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class TypedPatch:
    kind: str
    base_revision: str
    procedure: str
    path: tuple[str, ...] = ()
    expected_old: object = None
    value: object = None
    node: str = ""
    outcome: str = ""
    target: str = ""
    new_name: str = ""
    profile: str = "ensure-pdu-session"


@dataclass(frozen=True)
class Preview:
    before_revision: str
    after_revision: str
    before_text: str
    after_text: str
    unified_diff: str
    modified_spans: int


@dataclass(frozen=True)
class SourceDocument:
    text: str
    profile: str = "ensure-pdu-session"

    def __post_init__(self) -> None:
        _parse(self.text)

    @property
    def source_revision(self) -> str:
        return revision(self.text)

    def snapshot(self) -> CommentedMap:
        return _parse(self.text)

    def round_trip(self) -> str:
        """Read-only round-trip: returning exact original bytes is intentional."""
        _parse(self.text)
        return self.text

    def preview(self, patch: TypedPatch) -> Preview:
        if self.profile != "ensure-pdu-session" or patch.profile != self.profile:
            raise PatchRejected("transitional / unsupported profile is Source-only")
        if patch.base_revision != self.source_revision:
            raise PatchRejected("stale Source revision")
        tree = _parse(self.text)
        try:
            proc = tree["procedures"][patch.procedure]
            nodes = proc["nodes"]
            if not isinstance(proc, CommentedMap) or not isinstance(nodes, CommentedMap):
                raise PatchRejected("invalid Procedure mapping")
        except (KeyError, TypeError) as exc:
            raise PatchRejected("exact Procedure does not exist") from exc
        if patch.kind == "SetScalar":
            spans = self._set_scalar(tree, patch)
        elif patch.kind == "AddRoute":
            spans = self._add_route(proc, nodes, patch)
        elif patch.kind == "RenameNode":
            spans = self._rename_node(proc, nodes, patch)
        else:
            raise PatchRejected(f"unsupported Typed Patch operation: {patch.kind}")
        new_text = _apply_spans(self.text, spans)
        result = _parse(new_text)
        if result == tree:
            raise PatchRejected("patch does not change source semantics")
        self._verify_result(tree, result, patch)
        diff = "".join(difflib.unified_diff(self.text.splitlines(keepends=True),
                    new_text.splitlines(keepends=True), fromfile="before.yaml", tofile="after.yaml"))
        return Preview(self.source_revision, revision(new_text), self.text,
                       new_text, diff, len(spans))

    def apply(self, preview: Preview) -> "SourceDocument":
        if self.source_revision != preview.before_revision or self.text != preview.before_text:
            raise PatchRejected("preview no longer matches current Source revision")
        if revision(preview.after_text) != preview.after_revision:
            raise PatchRejected("preview content digest mismatch")
        return SourceDocument(preview.after_text, self.profile)

    def _set_scalar(self, tree: CommentedMap, patch: TypedPatch):
        if len(patch.path) < 2:
            raise PatchRejected("SetScalar requires a complete mapping path")
        if patch.path[:2] != ("procedures", patch.procedure) or len(patch.path) < 4:
            raise PatchRejected("SetScalar path must stay within selected Procedure")
        if "preconditions" in patch.path or "postconditions" in patch.path:
            raise PatchRejected("Transitional phase fields are Source-only")
        parent = _lookup(tree, patch.path[:-1])
        key = patch.path[-1]
        if not isinstance(parent, CommentedMap) or key not in parent:
            raise PatchRejected("SetScalar target does not exist")
        old = parent[key]
        if isinstance(old, (Mapping, list)) or type(old) not in (str, int, float, bool) and not isinstance(old, str):
            raise PatchRejected("SetScalar requires an existing single-line primitive")
        if type(old) != type(patch.expected_old) and not (isinstance(old, str) and type(patch.expected_old) is str):
            raise PatchRejected("SetScalar expected type differs")
        if old != patch.expected_old:
            raise PatchRejected("SetScalar precondition failed: old value differs")
        if type(patch.value) != type(patch.expected_old):
            raise PatchRejected("SetScalar would change the scalar type")
        # The first vertical slice edits authoring fields, not arbitrary
        # Runtime registrations. Route / start targets must remain local.
        proc = tree["procedures"][patch.procedure]
        if key == "start" and patch.value not in proc["nodes"]:
            raise PatchRejected("start target is not a node in this Procedure")
        if len(patch.path) >= 6 and patch.path[-2] == "on":
            node_id = patch.path[3]
            node = proc["nodes"].get(node_id)
            if not isinstance(node, CommentedMap) or key not in _allowed_outcomes(node):
                raise PatchRejected("route outcome does not match the exact Operator")
            if patch.value not in proc["nodes"]:
                raise PatchRejected("route target is not a node in this Procedure")
        return [_scalar_span(self.text, parent, key, patch.value)]

    def _add_route(self, proc: CommentedMap, nodes: CommentedMap, patch: TypedPatch):
        if patch.node not in nodes or patch.target not in nodes:
            raise PatchRejected("source Node or destination Node does not exist")
        node = nodes[patch.node]
        if not isinstance(node, CommentedMap) or "on" not in node or not isinstance(node["on"], CommentedMap):
            raise PatchRejected("AddRoute requires an existing operator-level on mapping")
        routes = node["on"]
        if patch.outcome in routes:
            raise PatchRejected("outcome is already routed")
        if not routes:
            raise PatchRejected("empty Route mapping is Source-only in this POC")
        outcomes = _allowed_outcomes(node)
        if patch.outcome not in outcomes:
            raise PatchRejected("Outcome unsupported for the exact Operator")
        if not _IDENTIFIER.fullmatch(patch.target):
            raise PatchRejected("target is not an admissible simple scalar")
        last = list(routes)[-1]
        last_line, col = routes.lc.key(last)
        _, after, newline = _line_parts(self.text, last_line)
        indent = " " * col
        insertion = indent + patch.outcome + ": " + patch.target + newline
        return [(after, after, insertion)]

    def _rename_node(self, proc: CommentedMap, nodes: CommentedMap, patch: TypedPatch):
        old, new = patch.node, patch.new_name
        if not _IDENTIFIER.fullmatch(old) or not _IDENTIFIER.fullmatch(new) or old not in nodes:
            raise PatchRejected("RenameNode requires an existing simple node identifier")
        if new in nodes or old == new:
            raise PatchRejected("new Node ID already exists or is unchanged")
        if patch.expected_old != old:
            raise PatchRejected("RenameNode expected_old must match the original ID")
        key_line, key_col = nodes.lc.key(old)
        base, _, _ = _line_parts(self.text, key_line)
        if self.text[base+key_col:base+key_col+len(old)] != old:
            raise PatchRejected("quoted / complex Node key is Source-only")
        spans = [(base+key_col, base+key_col+len(old), new)]
        if proc.get("start") == old:
            spans.append(_scalar_span(self.text, proc, "start", new))
        for other_node in nodes.values():
            if not isinstance(other_node, CommentedMap):
                raise PatchRejected("unsupported Node shape")
            # Current ensure profile exposes only operator routes; refuse phases
            # rather than silently missing a transitional route.
            if "preconditions" in other_node or "postconditions" in other_node:
                raise PatchRejected("phase-aware RenameNode requires another profile")
            routes = other_node.get("on")
            if isinstance(routes, Mapping):
                for outcome, target in routes.items():
                    if target == old:
                        spans.append(_scalar_span(self.text, routes, outcome, new))
            if other_node.get("reconcile") == old:
                spans.append(_scalar_span(self.text, other_node, "reconcile", new))
            _replace_bindings(self.text, other_node, old, new, spans)
        return spans

    def _verify_result(self, before: CommentedMap, after: CommentedMap, patch: TypedPatch) -> None:
        if patch.kind == "SetScalar":
            if _lookup(after, patch.path) != patch.value:
                raise PatchRejected("SetScalar semantic verification failed")
        elif patch.kind == "AddRoute":
            node = after["procedures"][patch.procedure]["nodes"][patch.node]
            if node["on"].get(patch.outcome) != patch.target:
                raise PatchRejected("AddRoute semantic verification failed")
        elif patch.kind == "RenameNode":
            nodes = after["procedures"][patch.procedure]["nodes"]
            if patch.new_name not in nodes or patch.node in nodes:
                raise PatchRejected("RenameNode semantic verification failed")
            # The entire set of node names must change by exactly one key.
            original = set(before["procedures"][patch.procedure]["nodes"])
            if set(nodes) != (original - {patch.node}) | {patch.new_name}:
                raise PatchRejected("RenameNode changed unrelated node identities")


def _lookup(tree: object, path: tuple[str, ...]):
    cur = tree
    for p in path:
        if not isinstance(cur, Mapping) or p not in cur:
            raise PatchRejected(f"unknown Source path component: {p}")
        cur = cur[p]
    return cur


def _allowed_outcomes(node: Mapping) -> frozenset[str]:
    if "verify" in node:
        return _VERIFY_OUTCOMES
    if node.get("call") == "pdu_session.create":
        return _CREATE_OUTCOMES
    if node.get("call") == "pdu_session.reconcile":
        return _RECONCILE_OUTCOMES
    raise PatchRejected("exact Operator has no proven outcome Profile")


def _line_parts(text: str, line_index: int) -> tuple[int, int, str]:
    lines = text.splitlines(keepends=True)
    if line_index >= len(lines):
        raise PatchRejected("source location outside input")
    offset = sum(map(len, lines[:line_index]))
    full = lines[line_index]
    if full.endswith("\r\n"):
        newline = "\r\n"
    elif full.endswith("\n"):
        newline = "\n"
    else:
        raise PatchRejected("cannot safely insert route after final line without a newline")
    return offset, offset+len(full), newline


def _scalar_span(text: str, parent: CommentedMap, key: str, value: object) -> tuple[int, int, str]:
    if not isinstance(parent, CommentedMap) or key not in parent:
        raise PatchRejected("source map is missing")
    if isinstance(parent[key], (LiteralScalarString, FoldedScalarString)):
        raise PatchRejected("block scalar is Source-only")
    line_index, col = parent.lc.value(key)
    base, _, _ = _line_parts(text, line_index)
    source_line = text.splitlines(keepends=True)[line_index]
    fragment = source_line[col:].rstrip("\r\n")
    if not fragment:
        raise PatchRejected("multiline or empty scalar is Source-only")
    # Value locations point at the opening quote or first plain character.
    if fragment.startswith("'"):
        match = re.match(r"'(?:[^']|'')*'", fragment)
    elif fragment.startswith('"'):
        match = re.match(r'"(?:[^"\\]|\\.)*"', fragment)
    else:
        match = re.match(r".*?(?=\s+#|$)", fragment)
    if match is None or not match.group():
        raise PatchRejected("cannot prove a single-line scalar boundary")
    token = match.group().rstrip()
    if "\n" in token or "\r" in token:
        raise PatchRejected("multiline scalar is Source-only")
    replacement = _encode_scalar(token, value)
    return base + col, base + col + len(token), replacement


def _encode_scalar(old_token: str, new_value: object) -> str:
    if type(new_value) is bool:
        return "true" if new_value else "false"
    if type(new_value) in (int, float):
        return str(new_value)
    if not isinstance(new_value, str) or "\n" in new_value or "\r" in new_value:
        raise PatchRejected("only single-line JSON scalar values are editable")
    if old_token.startswith("'"):
        return "'" + new_value.replace("'", "''") + "'"
    if old_token.startswith('"'):
        return json.dumps(new_value, ensure_ascii=False)
    # Inherit plain scalar style only when it round-trips as the exact string.
    if new_value and new_value.strip() == new_value and not new_value.startswith(("- ", "? ", ": ")):
        try:
            parsed = _parse("probe: " + new_value + "\n")["probe"]
            if type(parsed) is str and parsed == new_value:
                return new_value
        except PatchRejected:
            pass
    return "'" + new_value.replace("'", "''") + "'"


def _replace_bindings(text: str, value: object, old: str, new: str, spans: list) -> None:
    if not isinstance(value, CommentedMap):
        return
    for key, child in value.items():
        if key == "from" and isinstance(child, str) and child.startswith(old + "."):
            spans.append(_scalar_span(text, value, key, new + child[len(old):]))
        elif isinstance(child, CommentedMap):
            _replace_bindings(text, child, old, new, spans)
        elif isinstance(child, list):
            for item in child:
                _replace_bindings(text, item, old, new, spans)


def _apply_spans(text: str, spans: list[tuple[int, int, str]]) -> str:
    last_start = len(text) + 1
    for start, end, replacement in sorted(spans, key=lambda span: span[0], reverse=True):
        if start < 0 or end < start or end > len(text) or end > last_start:
            raise PatchRejected("overlapping or out-of-bounds Source spans")
        text = text[:start] + replacement + text[end:]
        last_start = start
    return text
