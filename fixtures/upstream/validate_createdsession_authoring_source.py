def validate_createdsession_authoring_source(instance: object, label: str) -> None:
    """Narrow authoring gate while canonical ProcedureSource lacks pre/post blocks."""
    if not isinstance(instance, dict) or set(instance) != {"procedures"}:
        fail(f"{label}: expected one procedures mapping")
    procedures = instance["procedures"]
    if not isinstance(procedures, dict):
        fail(f"{label}: procedures must be a mapping")
    root = procedures.get("ue-requested-pdu-session-establishment")
    if not isinstance(root, dict) or not isinstance(root.get("nodes"), dict):
        fail(f"{label}: missing CreatedSession root Procedure/nodes")

    nodes = root["nodes"]
    expected_main_prefix = [
        "nudm-sdm-get",
        "nudm-sdm-subscribe",
        "npcf-sm-policy-control-create",
        "n4-session-establishment",
        "namf-communication-n1n2-message-transfer",
        "pdu-session-resource-setup",
        "n4-session-modification",
        "finalize-success",
    ]
    if list(nodes)[:len(expected_main_prefix)] != expected_main_prefix:
        fail(f"{label}: CreatedSession main business-node order drifted")

    serialized = read(label)
    for forbidden in (
        "fivegc.",
        "npcf-smpolicycontrol-create",
        "confirm-udm-result",
        "confirm-policy-operation-context",
        "confirm-pcf-policy-association",
    ):
        if forbidden in serialized:
            fail(f"{label}: retired authoring form remains: {forbidden}")

    allowed_precondition_calls = {
        "ca.session.operation_context.read",
        "ca.session.pcf_create_inputs.read",
        "ca.session.establishment_response.prepare",
    }
    allowed_precondition_scripts = {"scripts/select_establishment_configuration.py"}
    allowed_precondition_procedures = {"await-ue-session-configuration"}
    precondition_fields = {"name", "script", "call", "verify", "procedure", "with"}

    for procedure_name, procedure in procedures.items():
        if not isinstance(procedure, dict):
            fail(f"{label}:{procedure_name}: Procedure must be a mapping")
        procedure_nodes = procedure.get("nodes") or {}
        if not isinstance(procedure_nodes, dict):
            fail(f"{label}:{procedure_name}: nodes must be a mapping")

        for node_name, node in procedure_nodes.items():
            node_label = f"{label}:{procedure_name}:{node_name}"
            if not isinstance(node, dict):
                fail(f"{node_label}: node must be a mapping")

            preconditions = node.get("preconditions")
            if preconditions is not None:
                if (
                    not isinstance(preconditions, dict)
                    or set(preconditions) != {"steps", "on"}
                ):
                    fail(f"{node_label}: preconditions require steps + on")
                steps = preconditions.get("steps")
                routes = preconditions.get("on")
                if not isinstance(steps, list) or not steps:
                    fail(f"{node_label}: preconditions.steps must be non-empty")
                if (
                    not isinstance(routes, dict)
                    or set(routes) != {"FAILED", "UNRESOLVED"}
                ):
                    fail(f"{node_label}: preconditions require FAILED/UNRESOLVED routes")
                if not all(isinstance(target, str) for target in routes.values()):
                    fail(f"{node_label}: precondition route targets must be strings")

                for step in steps:
                    if not isinstance(step, dict):
                        fail(f"{node_label}: precondition step must be a mapping")
                    if set(step) - precondition_fields:
                        fail(f"{node_label}: precondition step has unsupported fields")
                    operators = [
                        key for key in ("script", "call", "verify", "procedure")
                        if key in step
                    ]
                    if len(operators) != 1:
                        fail(f"{node_label}: each precondition step needs one operator")
                    if "call" in step and step["call"] not in allowed_precondition_calls:
                        fail(f"{node_label}: precondition call is not approved")
                    if "script" in step and step["script"] not in allowed_precondition_scripts:
                        fail(f"{node_label}: precondition script is not approved")
                    if (
                        "procedure" in step
                        and step["procedure"] not in allowed_precondition_procedures
                    ):
                        fail(f"{node_label}: precondition child Procedure is not approved")
                    if "with" in step and not isinstance(step["with"], dict):
                        fail(f"{node_label}: precondition with must be a mapping")

            postconditions = node.get("postconditions")
            if postconditions is not None:
                if (
                    not isinstance(postconditions, dict)
                    or set(postconditions) != {"steps", "on"}
                ):
                    fail(f"{node_label}: postconditions require steps + on")
                steps = postconditions.get("steps")
                routes = postconditions.get("on")
                if not isinstance(steps, list) or not steps:
                    fail(f"{node_label}: postconditions.steps must be non-empty")
                if (
                    not isinstance(routes, dict)
                    or set(routes) != {"PASS", "FAIL", "UNKNOWN"}
                ):
                    fail(f"{node_label}: postconditions require PASS/FAIL/UNKNOWN routes")
                if not all(isinstance(target, str) for target in routes.values()):
                    fail(f"{node_label}: postcondition route targets must be strings")

                for step in steps:
                    if not isinstance(step, dict) or set(step) - {"verify", "with"}:
                        fail(f"{node_label}: postcondition steps may only verify facts")
                    if not isinstance(step.get("verify"), str):
                        fail(f"{node_label}: each postcondition step needs a Predicate verify")
                    if "with" in step and not isinstance(step["with"], dict):
                        fail(f"{node_label}: postcondition with must be a mapping")

                node_routes = node.get("on") or {}
                if "SUCCEEDED" in node_routes or "COMMITTED" in node_routes:
                    fail(f"{node_label}: successful outcome must not bypass postconditions")

    # Validate every transition against the Procedure-local node set. The pinned
    # upstream schema cannot validate this authoring extension, so route integrity
    # must be enforced by this one transitional gate before any lowering occurs.
    for procedure_name, procedure in procedures.items():
        procedure_nodes = procedure.get("nodes")
        if not isinstance(procedure_nodes, dict) or not procedure_nodes:
            fail(f"{label}:{procedure_name}: nodes must be a non-empty mapping")
        start_node = procedure.get("start")
        if not isinstance(start_node, str) or start_node not in procedure_nodes:
            fail(f"{label}:{procedure_name}: start must name a node in this Procedure")

        for node_name, node in procedure_nodes.items():
            node_label = f"{label}:{procedure_name}:{node_name}"
            route_groups = []
            if "on" in node:
                route_groups.append(("on", node["on"]))
            for phase_name in ("preconditions", "postconditions"):
                phase = node.get(phase_name)
                if phase is not None:
                    route_groups.append((f"{phase_name}.on", phase["on"]))

            for route_name, routes in route_groups:
                if not isinstance(routes, dict):
                    fail(f"{node_label}: {route_name} must be a mapping")
                for outcome, target in routes.items():
                    if not isinstance(target, str) or target not in procedure_nodes:
                        fail(
                            f"{node_label}: {route_name}.{outcome} has unknown target "
                            f"{target!r} in Procedure {procedure_name}"
                        )

    subscribe_steps = nodes["nudm-sdm-subscribe"]["preconditions"]["steps"]
    subscribe_verifies = [
        step.get("verify") for step in subscribe_steps if "verify" in step
    ]
    for required in (
        "createdsession.pcf.create_inputs.ready",
        "createdsession.ingress.eligible",
        "createdsession.lifecycle.ready",
    ):
        if required not in subscribe_verifies:
            fail(f"{label}: first mutation is missing JIT precondition {required}")

    for mutation, reconcile in (
        ("nudm-sdm-subscribe", "reconcile-nudm-sdm-subscribe"),
        ("npcf-sm-policy-control-create", "reconcile-npcf-sm-policy-control-create"),
        ("namf-communication-n1n2-message-transfer", "reconcile-n1n2-message-transfer"),
    ):
        if nodes[mutation].get("on", {}).get("OUTCOME_UNKNOWN") != reconcile:
            fail(f"{label}:{mutation}: OUTCOME_UNKNOWN must reconcile the exact original node")
        reconcile_routes = (nodes.get(reconcile) or {}).get("on") or {}
        if set(reconcile_routes.values()) != {"safe-stopped"}:
            fail(f"{label}:{reconcile}: all reconcile outcomes must safe-stop this invocation")

