"""Read-only CreatedSession authoring guard derived from the pinned Demo baseline.

This is deliberately a *subset adapter*, not a replacement for ca-agent-demo's
scripts/validate_docs.py or the Runtime's linker/admission checks. No scripts,
capabilities or 5GC operations are executed.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .compat import load_demo_yaml


PINNED_DEMO_COMMIT = "bf445ad777149af5af2dfa0a5bdea18d0451303e"
MAIN_PREFIX = (
    "nudm-sdm-get", "nudm-sdm-subscribe", "npcf-sm-policy-control-create",
    "n4-session-establishment", "namf-communication-n1n2-message-transfer",
    "pdu-session-resource-setup", "n4-session-modification", "finalize-success",
)
PRECONDITION_CALLS = frozenset({
    "ca.session.operation_context.read", "ca.session.pcf_create_inputs.read",
    "ca.session.establishment_response.prepare",
})
PRECONDITION_SCRIPTS = frozenset({"scripts/select_establishment_configuration.py"})
PRECONDITION_PROCEDURES = frozenset({"await-ue-session-configuration"})
PRECONDITION_FIELDS = frozenset({"name", "script", "call", "verify", "procedure", "with"})
JIT_PREDICATES = frozenset({
    "createdsession.pcf.create_inputs.ready", "createdsession.ingress.eligible",
    "createdsession.lifecycle.ready",
})
RECONCILE_PAIRS = (
    ("nudm-sdm-subscribe", "reconcile-nudm-sdm-subscribe"),
    ("npcf-sm-policy-control-create", "reconcile-npcf-sm-policy-control-create"),
    ("namf-communication-n1n2-message-transfer", "reconcile-n1n2-message-transfer"),
)
RETIRED_FORMS = (
    "fivegc.", "npcf-smpolicycontrol-create", "confirm-udm-result",
    "confirm-policy-operation-context", "confirm-pcf-policy-association",
)


@dataclass(frozen=True)
class Diagnostic:
    code: str
    detail: str
    location: str


def validate_createdsession_source(source: str) -> tuple[Diagnostic, ...]:
    """Return deterministic diagnostics for the pinned, narrow source shape.

    This does not grant the transitional node-level phase syntax Runtime or
    Visual-writeback compatibility. Diagnostics are deliberately fail-closed.
    """
    issues: list[Diagnostic] = []

    def error(code: str, detail: str, location: str = "procedures") -> None:
        issues.append(Diagnostic(code, detail, location))

    try:
        tree = load_demo_yaml(source)
    except Exception as exc:
        return (Diagnostic("YAML_PARSE", str(exc), "source"),)
    if not isinstance(tree, Mapping) or set(tree) != {"procedures"}:
        return (Diagnostic("ENVELOPE", "expected a single procedures mapping", "source"),)
    procedures = tree["procedures"]
    if not isinstance(procedures, Mapping):
        return (Diagnostic("PROCEDURES", "procedures must be a mapping", "procedures"),)
    root = procedures.get("ue-requested-pdu-session-establishment")
    if not isinstance(root, Mapping) or not isinstance(root.get("nodes"), Mapping):
        return (Diagnostic("ROOT", "missing CreatedSession root or nodes", "procedures"),)
    root_nodes = root["nodes"]
    if tuple(root_nodes)[:len(MAIN_PREFIX)] != MAIN_PREFIX:
        error("MAIN_ORDER", "CreatedSession main business-node order drifted")
    for forbidden in RETIRED_FORMS:
        if forbidden in source:
            error("RETIRED_FORM", f"retired authoring form {forbidden}", "source")

    for name, procedure in procedures.items():
        if not isinstance(procedure, Mapping):
            error("PROCEDURE", "Procedure must be a mapping", str(name))
            continue
        nodes = procedure.get("nodes")
        if not isinstance(nodes, Mapping) or not nodes:
            error("NODES", "nodes must be a non-empty mapping", str(name))
            continue
        if not isinstance(procedure.get("start"), str) or procedure["start"] not in nodes:
            error("START", "start must identify a local node", str(name))
        for node_name, node in nodes.items():
            loc = f"{name}.nodes.{node_name}"
            if not isinstance(node, Mapping):
                error("NODE", "node must be a mapping", loc)
                continue
            for phase_name in ("preconditions", "postconditions"):
                phase = node.get(phase_name)
                if phase is None:
                    continue
                phase_loc = f"{loc}.{phase_name}"
                if not isinstance(phase, Mapping) or set(phase) != {"steps", "on"}:
                    error("PHASE_SHAPE", "phase requires exactly steps and on", phase_loc)
                    continue
                steps, routes = phase["steps"], phase["on"]
                if not isinstance(steps, list) or not steps:
                    error("PHASE_STEPS", "phase steps must be a non-empty sequence", phase_loc)
                expected = {"FAILED", "UNRESOLVED"} if phase_name == "preconditions" else {"PASS", "FAIL", "UNKNOWN"}
                if not isinstance(routes, Mapping) or set(routes) != expected:
                    error("PHASE_OUTCOMES", "invalid phase outcome set", phase_loc)
                if isinstance(steps, list):
                    for idx, step in enumerate(steps):
                        step_loc = f"{phase_loc}.steps[{idx}]"
                        if not isinstance(step, Mapping):
                            error("PHASE_STEP", "step must be a mapping", step_loc)
                            continue
                        if phase_name == "preconditions":
                            if set(step) - PRECONDITION_FIELDS:
                                error("PRECONDITION_FIELDS", "unsupported precondition step fields", step_loc)
                            operators = [op for op in ("script", "call", "verify", "procedure") if op in step]
                            if len(operators) != 1:
                                error("PRECONDITION_OPERATOR", "step requires exactly one operator", step_loc)
                            if "call" in step and step["call"] not in PRECONDITION_CALLS:
                                error("PRECONDITION_CALL", "call is not approved", step_loc)
                            if "script" in step and step["script"] not in PRECONDITION_SCRIPTS:
                                error("PRECONDITION_SCRIPT", "script is not approved", step_loc)
                            if "procedure" in step and step["procedure"] not in PRECONDITION_PROCEDURES:
                                error("PRECONDITION_CHILD", "child Procedure is not approved", step_loc)
                        else:
                            if set(step) - {"verify", "with"} or not isinstance(step.get("verify"), str):
                                error("POSTCONDITION_STEP", "postcondition must verify exactly one fact", step_loc)
                        if "with" in step and not isinstance(step["with"], Mapping):
                            error("PHASE_WITH", "with must be a mapping", step_loc)
                if phase_name == "postconditions":
                    node_routes = node.get("on") or {}
                    if isinstance(node_routes, Mapping) and ({"SUCCEEDED", "COMMITTED"} & set(node_routes)):
                        error("POSTCONDITION_BYPASS", "success cannot bypass postconditions", loc)
            groups = [("on", node.get("on"))] if "on" in node else []
            for phase_name in ("preconditions", "postconditions"):
                phase = node.get(phase_name)
                if isinstance(phase, Mapping) and "on" in phase:
                    groups.append((phase_name + ".on", phase["on"]))
            for route_name, routes in groups:
                if not isinstance(routes, Mapping):
                    error("ROUTE_MAP", "routes must be a mapping", f"{loc}.{route_name}")
                    continue
                for outcome, target in routes.items():
                    if not isinstance(target, str) or target not in nodes:
                        error("ROUTE_TARGET", f"invalid destination for {outcome}", f"{loc}.{route_name}.{outcome}")

    subscribe = root_nodes.get("nudm-sdm-subscribe")
    pre = subscribe.get("preconditions") if isinstance(subscribe, Mapping) else None
    steps = pre.get("steps") if isinstance(pre, Mapping) else None
    if not isinstance(steps, list):
        error("SUBSCRIBE_PRECONDITIONS", "missing first-mutation JIT steps")
    else:
        seen = {step.get("verify") for step in steps if isinstance(step, Mapping) and isinstance(step.get("verify"), str)}
        for predicate in sorted(JIT_PREDICATES - seen):
            error("JIT_PREDICATE", f"first mutation missing JIT precondition {predicate}")
    for mutation, reconcile in RECONCILE_PAIRS:
        node = root_nodes.get(mutation)
        routes = node.get("on") if isinstance(node, Mapping) else None
        if not isinstance(routes, Mapping) or routes.get("OUTCOME_UNKNOWN") != reconcile:
            error("RECONCILE_TARGET", f"{mutation} must route OUTCOME_UNKNOWN to {reconcile}")
        recon_node = root_nodes.get(reconcile)
        recon_routes = recon_node.get("on") if isinstance(recon_node, Mapping) else None
        if not isinstance(recon_routes, Mapping) or set(recon_routes.values()) != {"safe-stopped"}:
            error("RECONCILE_STOP", f"{reconcile} must only route to safe-stopped")
    return tuple(issues)
