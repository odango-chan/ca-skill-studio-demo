"""Validate current SMF session facts before N4 forwarding modification.

The Observation is a fresh, read-only business query after the Step 15
continuation. ABSENT is a known business failure at this point;
PRESENT+UNAVAILABLE is known presence but insufficient data. Indeterminate
query failures are Owner UNKNOWN outcomes and do not fabricate an output.
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
            "reasonCode": "SMF_SESSION_CONTEXT_EVIDENCE_MISSING",
            "evidenceUsed": [],
        }

    observation = input["sessionContext"]
    presence = observation["sessionPresence"]
    projection = observation["projectionStatus"]
    source_outcome = observation["sourceOutcome"]
    context = observation["context"]

    if presence == "ABSENT":
        if projection == "NOT_APPLICABLE" and source_outcome == "SESSION_NOT_FOUND" and context == {}:
            return {
                "result": "FAIL",
                "reasonCode": "SMF_SESSION_CONTEXT_ABSENT_AFTER_UPDATE",
                "evidenceUsed": evidence_refs,
            }
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_SESSION_CONTEXT_ABSENCE_RESULT_MALFORMED",
            "evidenceUsed": evidence_refs,
        }

    if presence != "PRESENT" or source_outcome != "CONTEXT_RESPONSE":
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_SESSION_CONTEXT_PRESENCE_UNKNOWN",
            "evidenceUsed": evidence_refs,
        }

    if projection != "AVAILABLE":
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_SESSION_CONTEXT_PROJECTION_UNAVAILABLE",
            "evidenceUsed": evidence_refs,
        }

    required = ("dnn", "sst", "subscriptionValidated", "secondaryAuthRequired", "uecmRegistered")
    if any(field not in context for field in required):
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_SESSION_CONTEXT_FIELDS_INCOMPLETE",
            "evidenceUsed": evidence_refs,
        }

    if type(context["uecmRegistered"]) is not bool:
        return {
            "result": "UNKNOWN",
            "reasonCode": "SMF_UECM_REGISTRATION_STATE_INVALID",
            "evidenceUsed": evidence_refs,
        }

    if context["dnn"] != input["requestedDnn"] or context["sst"] != input["requestedSst"]:
        return {
            "result": "FAIL",
            "reasonCode": "SMF_SESSION_CONTEXT_REQUEST_MISMATCH",
            "evidenceUsed": evidence_refs,
        }

    if context["subscriptionValidated"] is not True:
        return {
            "result": "FAIL",
            "reasonCode": "SMF_SUBSCRIPTION_NOT_VALIDATED",
            "evidenceUsed": evidence_refs,
        }

    if context["secondaryAuthRequired"] is not False:
        return {
            "result": "FAIL",
            "reasonCode": "SECONDARY_AUTHENTICATION_REQUIRED_OUT_OF_PROFILE",
            "evidenceUsed": evidence_refs,
        }

    return {
        "result": "PASS",
        "reasonCode": "SMF_SESSION_CONTEXT_PROFILE_MATCHED",
        "evidenceUsed": evidence_refs,
    }
