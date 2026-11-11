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

    expected_operation_ref = input.get("subject", {}).get("amfTransferOperationRef")
    if (not isinstance(expected_operation_ref, str) or not expected_operation_ref
            or response.get("operationRef") != expected_operation_ref):
        return {
            "result": "UNKNOWN",
            "reasonCode": "AMF_PRODUCER_EVIDENCE_MISMATCH",
            "evidenceUsed": refs,
        }

    result = "UNKNOWN"
    reason = "TRANSFER_NOT_PROVEN"
    status = response.get("httpStatus")
    if (response.get("networkOutcome") == "HTTP_RESPONSE"
            and response.get("responseOrigin") == "TARGET_SERVICE_VIA_SCP"
            and response.get("captureComplete") is True and type(status) is int):
        if status == 200 and response.get("cause") == "N1_N2_TRANSFER_INITIATED":
            result = "PASS"
            reason = "TRANSFER_INITIATED_ONLY"
        elif status >= 400 and status <= 599:
            result = "FAIL"
            reason = "AMF_TARGET_HTTP_ERROR"
    return {"result": result, "reasonCode": reason, "evidenceUsed": refs}
