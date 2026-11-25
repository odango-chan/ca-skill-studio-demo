# CA-SL v1alpha5 Scheme C — Create / Modify / Release

This is the default Skill Studio Example. It contains the three real OpenAMSM
Scheme C Skills from `odango-chan/ca-skills`, not a separate illustrative
workflow:

1. **Create** — `establish-pdu-session-mas`
2. **Modify** — `modify-pdu-session-mas`
3. **Release** — `release-pdu-session-mas`

The default Procedure is Create. All three source packages are pinned to
`ca-skills` commit `83d9e0c7d523189a1ae03186f8913277f0829d72` (PR #86 head; PR #86 is the documentation
correction following the merged Owner-linked Skill update in PR #85).

## Locked dependencies

- **`mas` — Owner ToolCatalog v1alpha4:** stable Package ID
  `urn:openamsm:mas:tool-contracts`, Owner `openamsm.smf.mas`, exact
  `ca-client-tools v1.2.0` source commit `fc44c3a745c68443fcfb12054c7eadf0ed7cc3f7`, and Owner build
  identity `sha256:ac834080f31ff0fa91b9eb846fa47c889a94837fc1f37ec2034190e4e83085c0`. The bundled manifest verifies
  all 58 published artifacts, including the ToolCatalog, callable Schemas,
  Evidence Guarantees, receipt/proof/reconcile Schemas and CapabilityContracts.
- **`ca-context` — Host subject-context Schema:** stable Package ID
  `urn:connectionagent:ca:host-context`. Its single subject Schema is taken
  from the exact `ca-agent-demo` Development fixture commit
  `57e277ff9094dad93543df46910a12a1dbbaf560`; it is explicitly a Host-provided Development fixture, not a
  production trust grant.
- **`ca-client` — read-only Interface Package:** the existing published
  `ca-client-tools v1.1.0` Interface Package remains available for read-only
  SBI query completions. These three MAS mutation Skills do not use it as their
  Owner contract and it does not export the MAS mutation callables.

The **CA Client Tools v1.2.0 Runtime Provider is published**. It supplies the
typed runtime bindings from the published Owner v1alpha4 contract. The runtime
Provider, its read-only Interface Package, and the Owner ToolCatalog are
separate artifacts; this Example keeps those boundaries explicit.

## Verification and qualification

- **Static Compiler:** PASS for the Owner-linked Skill source in
  `ca-skills` PR #85 using released `skillc v2.0.2` and the published Owner
  v1alpha4 contract. PR #86 only corrects the Skill adoption-status prose.
- **Current-source Development E2E:** NOT RUN. The prior real
  Create → Modify → Release Development E2E in
  `ca-agent-demo/artifacts/reviews/20261123-scheme-c-final` used the earlier
  `ca-skills` PR #84 source commit `494b05f` and a synthetic development
  Owner closure. It must not be presented as E2E evidence for this newer
  Owner-linked source.
- **Production Qualification:** NOT QUALIFIED. A verified dependency snapshot
  or static Compiler Build is not deployment admission, Owner authorization,
  durable mutation receipt proof, or Production qualification.

The project lock is a reproducible source snapshot. Skill Studio does not turn
its presence into Owner authorization or deployment trust. The Compiler and
Runtime must report missing trust explicitly rather than infer it from this
Example.
