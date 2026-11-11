import json
from typing import Annotated, Literal, NotRequired, TypedDict


class Snssai(TypedDict):
    sst: Annotated[int, {"minimum": 0, "maximum": 255}]
    sd: NotRequired[Annotated[int, {"minimum": 0, "maximum": 16777214}]]


class PduSessionTypes(TypedDict):
    defaultSessionType: Literal["IPV4", "IPV6", "IPV4V6"]
    allowedSessionTypes: NotRequired[
        Annotated[list[Literal["IPV4", "IPV6", "IPV4V6"]], {"minItems": 1, "uniqueItems": True}]
    ]


class SscModes(TypedDict):
    defaultSscMode: Annotated[int, {"minimum": 1, "maximum": 3}]
    allowedSscModes: NotRequired[
        Annotated[list[Annotated[int, {"minimum": 1, "maximum": 3}]], {"minItems": 1, "maxItems": 3, "uniqueItems": True}]
    ]


class SessionAmbr(TypedDict):
    uplink: Annotated[str, {"pattern": r"^[0-9]+(\.[0-9]+)? (bps|Kbps|Mbps|Gbps|Tbps)$"}]
    downlink: Annotated[str, {"pattern": r"^[0-9]+(\.[0-9]+)? (bps|Kbps|Mbps|Gbps|Tbps)$"}]


class Arp(TypedDict):
    priorityLevel: Annotated[int, {"minimum": 1, "maximum": 15}]
    preemptCap: Literal["MAY_PREEMPT", "NOT_PREEMPT"]
    preemptVuln: Literal["PREEMPTABLE", "NOT_PREEMPTABLE"]


class DefaultQos(TypedDict):
    fiveQi: Annotated[int, {"minimum": 0, "maximum": 255}]
    arp: Arp


class SubscriptionData(TypedDict):
    sNssai: Snssai
    dnn: Annotated[str, {"minLength": 1, "pattern": r"^[a-z0-9][a-z0-9.-]*$"}]
    pduSessionTypes: PduSessionTypes
    sscModes: SscModes
    sessionAmbr: SessionAmbr
    defaultQos: DefaultQos


class SubscriptionSource(TypedDict):
    transactionRef: Annotated[str, {"minLength": 1}]
    requestRef: Annotated[str, {"minLength": 1}]
    fabricRecordRef: Annotated[str, {"minLength": 1}]
    fabricRecordDigest: Annotated[str, {"pattern": r"^sha256:[0-9a-f]{64}$"}]


class EstablishmentSelectionOutput(TypedDict):
    dnn: Annotated[str, {"minLength": 1, "pattern": r"^[a-z0-9][a-z0-9.-]*$"}]
    sNssai: Snssai
    pduSessionType: Literal["IPV4"]
    sscMode: Literal[1]
    subscriptionData: SubscriptionData
    subscriptionSource: SubscriptionSource


def main(input: dict) -> EstablishmentSelectionOutput:
    request = input
    result = input["udmResult"]
    subscription = result["subscription"]
    if (result.get("selection") != "MATCHED" or result.get("httpStatus") != 200
            or result.get("networkOutcome") != "HTTP_RESPONSE"
            or result.get("responseOrigin") != "TARGET_SERVICE_VIA_SCP"
            or result.get("captureComplete") is not True):
        raise ValueError("subscription is not from a complete matched target response")
    if request["requestedPduSessionType"] != "IPV4" or type(request["requestedSscMode"]) is not int or request["requestedSscMode"] != 1:
        raise ValueError("unsupported explicitly decoded UE request")
    if subscription["dnn"] != request["dnn"] or subscription["sNssai"] != request["sNssai"]:
        raise ValueError("subscription scope mismatch")
    types = subscription["pduSessionTypes"]
    modes = subscription["sscModes"]
    allowed_types = types.get("allowedSessionTypes", [types["defaultSessionType"]])
    allowed_modes = modes.get("allowedSscModes", [])
    # The governed input schema constrains item types, enum values and nonempty arrays.
    if type(allowed_types) is not list or not allowed_types:
        raise ValueError("invalid subscription allowed values")
    if type(allowed_modes) is not list or not allowed_modes:
        raise ValueError("invalid subscription allowed values")
    if type(allowed_modes[0]) is not int:
        raise ValueError("invalid subscription allowed values")
    if "IPV4" not in allowed_types or (1 != modes["defaultSscMode"] and 1 not in allowed_modes):
        raise ValueError("UE request is not permitted by subscription")
    if (type(subscription.get("sessionAmbr")) is not dict
            or type(subscription.get("defaultQos")) is not dict):
        raise ValueError("this profile requires subscribed AMBR and default QoS")
    # Preserve subscribed values as inputs to policy, not as PCF-authorized QoS.
    # No hidden default, second UDM read or SMF cache lookup may fill these in.
    return {
        "dnn": request["dnn"], "sNssai": dict(request["sNssai"]),
        "pduSessionType": "IPV4", "sscMode": 1,
        "subscriptionData": json.loads(json.dumps(subscription)),
        "subscriptionSource": {
            "transactionRef": result["transactionRef"],
            "requestRef": result["requestRef"],
            "fabricRecordRef": result["fabricRecordRef"],
            "fabricRecordDigest": result["fabricRecordDigest"],
        },
    }
