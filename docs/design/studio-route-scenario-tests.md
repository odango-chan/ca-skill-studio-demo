# Procedure Route Scenario Tests (Studio-only)

**Status:** offline editor testing capability. Not part of CA-SL v1alpha5 language, the Compiler contract, or Runtime qualification.

A route scenario replays explicit, finite Stage Outcomes against the current Package's assurance/procedure.yaml. It checks Stage ordering, implicit same-Node progression, exact explicit routes, Wait timeout routing, and the requested terminal. It does not evaluate Predicate results, execute Scripts, invoke Tools, admit Ingress, prove Evidence, verify an Owner, or publish a Runtime terminal.

## Author a scenario

Create a UTF-8 JSON file at, for example, skills/establish-pdu-session/tests/entry-rejected.route-scenario.json:

~~~json
{
  "apiVersion": "skill-studio-route-scenario/v1",
  "id": "entry-rejected",
  "steps": [
    {
      "node": "get-sm-subscription-data",
      "stage": "precondition",
      "outcome": "FAIL"
    }
  ],
  "expect": {
    "terminal": "FAILED"
  }
}
~~~

This checks that a *simulated* Precondition FAIL requests FAILED without reaching an Operation. The test does not execute establishment.request.supported.

For Wait, a scenario must list all preceding Stage Outcomes, followed by a Step with stage wait and outcome TIMEOUT (or EVENT_RECEIVED). TIMEOUT uses the source Wait route, while EVENT_RECEIVED proceeds to the first declared business Stage. Neither input performs real Host event registration or correlation.

## Run

Open the target assurance/procedure.yaml in Skill Studio. In the Testing view, choose **SKILL Studio · Procedure Route Scenarios**, or use the command **SKILL Studio: Replay Procedure Route Scenarios (No Runtime)**.

The view exposes pinned example route regressions for establish-pdu-session and establish-pdu-session-mas, and Package-local tests/*.route-scenario.json. Choose an individual authored case or run all. The Output channel records the per-Stage trace.

The result API is skill-studio-route-test-results/v1. PASS means scripted Outcomes followed the specified Route to the expected terminal; FAIL means a malformed/inconsistent/incomplete script or a different terminal; NOT_RUN means the required current source snapshot was unavailable. All results retain qualification NOT_QUALIFIED, including a scenario whose expected terminal is SUCCEEDED.

## Safety boundaries

- Read-only complete Package snapshot; unsaved open source is included.
- Only direct Package-local tests/*.route-scenario.json files are loaded; no imports or external network.
- Up to 32 authored sidecar files, 128 KiB each, 256 explicit Stage Outcomes per scenario.
- Duplicate authored IDs, malformed JSON and oversized files are visible failures; no silent fallback.
- Stage Outcome symbols follow CA-SL v1alpha5 sections 12.1 and 22. Wait EVENT_RECEIVED is an artificial control input, not a fifth business stage.
- Tool effect/Owner/Schema linking is not proven by this route-only layer.
- No mock Tool result JSON, Predicate evaluation, Provider API transport, or HTTP/2 execution is included yet. Those need separately versioned test and integration contracts.

Keep five independent surfaces: Source Problems; synthetic diagnostic regressions; route scenario replay; authoritative Compiler Check/Build; and actual Host/Runtime/Provider evidence. A PASS in one does not transfer qualification to another.
