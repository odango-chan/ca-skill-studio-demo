"""Validate the requested session profile against the exact UDM subscription result.

This is a Step 4 Postcondition evaluator, not a Procedure Operation and not a
replacement for native SMF Step 8 UPF/session-address selection. G.4 does not
allow JSON Schema pattern, so DNN and S-NSSAI SD lexical checks live here.
"""
from __future__ import annotations

from typing import Annotated, Literal, TypedDict


class PredicateEvaluationResult(TypedDict):
    result: Literal["PASS", "FAIL", "UNKNOWN"]
    reasonCode: Annotated[str, {"minLength": 1}]
    evidenceUsed: list[str]


def _ascii_alphanumeric(value: str) -> bool:
    return (
        "a" <= value <= "z"
        or "A" <= value <= "Z"
        or "0" <= value <= "9"
    )


def _valid_dnn(value: str) -> bool:
    if not isinstance(value, str) or not value or len(value) > 100:
        return False
    # A trailing root dot is accepted; empty interior labels are not.
    normalized = value[:-1] if value.endswith(".") else value
    if not normalized:
        return False
    labels = normalized.split(".")
    for label in labels:
        if not 1 <= len(label) <= 63:
            return False
        if not _ascii_alphanumeric(label[0]) or not _ascii_alphanumeric(label[-1]):
            return False
        if any(not _ascii_alphanumeric(char) and char != "-" for char in label):
            return False
    return True


def _valid_s_nssai_sd(s_nssai: dict) -> bool:
    if "sd" not in s_nssai:
        return True
    sd = s_nssai["sd"]
    return (
        isinstance(sd, str)
        and len(sd) == 6
        and all(char in "0123456789abcdefABCDEF" for char in sd)
    )


def main(input: PredicateInput) -> PredicateEvaluationResult:
    requested_dnn = input["requestedDnn"]
    requested_s_nssai = dict(input["requestedSNssai"])
    if not _valid_dnn(requested_dnn):
        return {
            "result": "FAIL",
            "reasonCode": "REQUEST_DNN_INVALID",
            "evidenceUsed": [],
        }
    if not _valid_s_nssai_sd(requested_s_nssai):
        return {
            "result": "FAIL",
            "reasonCode": "REQUEST_SNSSAI_SD_INVALID",
            "evidenceUsed": [],
        }

    evidence_refs = input["evidence"]["receipt"]["refs"]
    if not evidence_refs:
        return {
            "result": "UNKNOWN",
            "reasonCode": "UDM_SUBSCRIPTION_EVIDENCE_MISSING",
            "evidenceUsed": [],
        }

    subscription = input["receipt"]["result"]["subscription"]
    subscription_s_nssai = dict(subscription["sNssai"])
    # The 3GPP SD is optional. Normalize an omitted SD and the source's
    # empty-string default to the same absent value before exact comparison.
    requested_s_nssai.setdefault("sd", "")
    subscription_s_nssai.setdefault("sd", "")
    if subscription_s_nssai["sd"] == "":
        subscription_s_nssai.pop("sd")
    if requested_s_nssai["sd"] == "":
        requested_s_nssai.pop("sd")

    if (
        subscription["dnn"] != requested_dnn
        or subscription_s_nssai != requested_s_nssai
    ):
        return {
            "result": "FAIL",
            "reasonCode": "UDM_SUBSCRIPTION_SCOPE_MISMATCH",
            "evidenceUsed": evidence_refs,
        }

    session_types = subscription["pduSessionTypes"]
    allowed_types = session_types.get(
        "allowedSessionTypes", [session_types["defaultSessionType"]]
    )
    if input["requestedPduSessionType"] not in allowed_types:
        return {
            "result": "FAIL",
            "reasonCode": "PDU_SESSION_TYPE_NOT_ALLOWED",
            "evidenceUsed": evidence_refs,
        }

    ssc_modes = subscription["sscModes"]
    allowed_modes = ssc_modes.get("allowedSscModes", [])
    if (
        input["requestedSscMode"] != ssc_modes["defaultSscMode"]
        and input["requestedSscMode"] not in allowed_modes
    ):
        return {
            "result": "FAIL",
            "reasonCode": "SSC_MODE_NOT_ALLOWED",
            "evidenceUsed": evidence_refs,
        }

    return {
        "result": "PASS",
        "reasonCode": "UDM_SUBSCRIPTION_PROFILE_MATCHES_REQUEST",
        "evidenceUsed": evidence_refs,
    }
