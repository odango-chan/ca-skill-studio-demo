from typing import Annotated, Literal, TypedDict


class PredicateEvaluationResult(TypedDict):
    result: Literal["PASS", "FAIL", "UNKNOWN"]
    reasonCode: Annotated[str, {"pattern": r"^[A-Z][A-Z0-9_]*$"}]
    evidenceUsed: Annotated[list[Annotated[str, {"minLength": 1}]], {"uniqueItems": True}]


def main(input: dict) -> PredicateEvaluationResult:
    response = input["observations"]["response"]
    refs = []
    for metadata in input.get("evidence", {}).values():
        for ref in metadata.get("refs", []):
            if ref not in refs:
                refs.append(ref)
    result = "UNKNOWN"
    reason = "UDM_RESULT_UNUSABLE"
    # Runtime supplies the composed subject from the producing call, then
    # independently acquires the Observation with that invocation/transaction.
    # Neither a model-supplied receipt nor a latest-per-UE lookup is admissible.
    receipt = input.get("subject", {}).get("udmReadReceipt")
    if (not isinstance(receipt, dict) or not isinstance(receipt.get("invocationId"), str)
            or not receipt["invocationId"] or response != receipt.get("result")):
        return {"result": "UNKNOWN", "reasonCode": "UDM_PRODUCER_EVIDENCE_MISMATCH", "evidenceUsed": refs}
    status = response.get("httpStatus")
    if (response.get("networkOutcome") == "HTTP_RESPONSE"
            and response.get("responseOrigin") == "TARGET_SERVICE_VIA_SCP"
            and response.get("captureComplete") is True and type(status) is int):
        selection = response.get("selection")
        subscription = response.get("subscription")
        if status == 200 and selection == "MATCHED" and isinstance(subscription, dict):
            ssc_modes = subscription.get("sscModes")
            allowed_modes = ssc_modes.get("allowedSscModes") if isinstance(ssc_modes, dict) else None
            is_open5gs_compat_shape = (
                isinstance(ssc_modes, dict)
                and type(ssc_modes.get("defaultSscMode")) is int
                and ssc_modes["defaultSscMode"] == 1
                and type(allowed_modes) is list
                and allowed_modes == [1, 2, 3]
            )
            result = "PASS"
            reason = "UDM_SUBSCRIPTION_MATCHED"
            if is_open5gs_compat_shape:
                reason = "UDM_OPEN5GS_SSC_COMPATIBILITY_APPLIED"
        elif status == 200 and selection == "NO_MATCH":
            result = "FAIL"
            reason = "UDM_SUBSCRIPTION_NOT_MATCHED"
        elif selection == "HTTP_ERROR" and status >= 400 and status <= 599:
            result = "FAIL"
            reason = "UDM_TARGET_HTTP_ERROR"
        elif selection == "AMBIGUOUS":
            reason = "UDM_SUBSCRIPTION_AMBIGUOUS"
        elif selection == "INVALID_PAYLOAD":
            reason = "UDM_RESPONSE_INVALID_PAYLOAD"
        elif selection == "INVALID_PROFILE_DATA":
            reason = "UDM_SUBSCRIPTION_INVALID_PROFILE"
        elif selection == "UNSUPPORTED_ENUM":
            reason = "UDM_SUBSCRIPTION_UNSUPPORTED_ENUM"
        elif selection == "UNSUPPORTED_STATUS":
            reason = "UDM_RESPONSE_UNSUPPORTED_STATUS"
        elif selection == "UNSUPPORTED_VARIANT":
            reason = "UDM_SUBSCRIPTION_UNSUPPORTED_VARIANT"
    elif response.get("networkOutcome") == "TIMEOUT":
        reason = "UDM_READ_TIMEOUT"
    elif response.get("networkOutcome") == "TRANSPORT_FAILURE":
        reason = "UDM_READ_TRANSPORT_FAILURE"
    return {"result": result, "reasonCode": reason, "evidenceUsed": refs}
