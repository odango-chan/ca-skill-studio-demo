"""Classify exact UE/PSI SM Context presence at Skill entry.

The generic Host Observation normalizes the SC compatibility response:
- 404 SESSION_NOT_FOUND -> ABSENT + NOT_APPLICABLE + SESSION_NOT_FOUND
- 200 AVAILABLE/UNAVAILABLE -> PRESENT + corresponding projectionStatus + CONTEXT_RESPONSE
- indeterminate transport/authentication failures -> Owner UNKNOWN outcome

Only an evidenced ABSENT result selects initial creation. PRESENT is not absence.
"""
from __future__ import annotations

from typing import Annotated, Literal, TypedDict


class PredicateEvaluationResult(TypedDict):
    result: Literal["PASS", "FAIL", "UNKNOWN"]
    reasonCode: Annotated[str, {"minLength": 1}]
    evidenceUsed: list[str]


def main(input: PredicateInput) -> PredicateEvaluationResult:
    evidence_refs = input["evidence"]["sessionContext"]["refs"]
    if not evidence_refs:
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_SESSION_CONTEXT_ENTRY_EVIDENCE_MISSING",
            "evidenceUsed": [],
        }

    observation = input["sessionContext"]
    presence = observation["sessionPresence"]
    projection = observation["projectionStatus"]
    source_outcome = observation["sourceOutcome"]
    context = observation["context"]

    if presence == "ABSENT":
        if (
            projection == "NOT_APPLICABLE"
            and source_outcome == "SESSION_NOT_FOUND"
            and context == {}
        ):
            return {
                "result": "PASS",
                "reasonCode": "SMF_SESSION_CONTEXT_CONFIRMED_ABSENT",
                "evidenceUsed": evidence_refs,
            }
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_SESSION_CONTEXT_ABSENCE_RESULT_MALFORMED",
            "evidenceUsed": evidence_refs,
        }

    if presence == "PRESENT":
        if source_outcome == "CONTEXT_RESPONSE" and projection in {"AVAILABLE", "UNAVAILABLE"}:
            return {
                "result": "FAIL",
                "reasonCode": "SMF_SESSION_CONTEXT_ALREADY_PRESENT",
                "evidenceUsed": evidence_refs,
            }
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_SESSION_CONTEXT_PRESENCE_RESULT_MALFORMED",
            "evidenceUsed": evidence_refs,
        }

    return {
        "result": "UNKNOWN",
        "reasonCode": "SMF_SESSION_CONTEXT_PRESENCE_UNKNOWN",
        "evidenceUsed": evidence_refs,
    }
