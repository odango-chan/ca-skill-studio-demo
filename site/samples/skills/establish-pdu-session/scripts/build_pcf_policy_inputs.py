from typing import Annotated, Literal, NotRequired, TypedDict


class Ambr(TypedDict):
    uplink: Annotated[str, {"pattern": r"^[0-9]+(\.[0-9]+)? (bps|Kbps|Mbps|Gbps|Tbps)$"}]
    downlink: Annotated[str, {"pattern": r"^[0-9]+(\.[0-9]+)? (bps|Kbps|Mbps|Gbps|Tbps)$"}]


class Arp(TypedDict):
    priorityLevel: Annotated[int, {"minimum": 1, "maximum": 15}]
    preemptCap: Literal["MAY_PREEMPT", "NOT_PREEMPT"]
    preemptVuln: Literal["PREEMPTABLE", "NOT_PREEMPTABLE"]


DefaultQos = TypedDict(
    "DefaultQos",
    {
        "5qi": Annotated[int, {"minimum": 0, "maximum": 255}],
        "priorityLevel": NotRequired[Annotated[int, {"minimum": 1, "maximum": 127}]],
        "arp": Arp,
    },
)


class SubscriptionSource(TypedDict):
    transactionRef: Annotated[str, {"minLength": 1}]
    requestRef: Annotated[str, {"minLength": 1}]
    fabricRecordRef: Annotated[str, {"minLength": 1}]
    fabricRecordDigest: Annotated[str, {"pattern": r"^sha256:[0-9a-f]{64}$"}]


class PcfPolicyInputsOutput(TypedDict):
    ambr: Ambr
    defaultQos: DefaultQos
    subscriptionSource: SubscriptionSource


def main(input: dict) -> PcfPolicyInputsOutput:
    # The subscription material was already derived from the exact UDM read by
    # the admitted selection script. This script only chooses which of those
    # verified values become PCF policy inputs; the Backend independently
    # projects and range-checks them before any hold is claimed or sent.
    subscription = input["subscriptionData"]
    source = input["subscriptionSource"]
    ambr = subscription["sessionAmbr"]
    qos = subscription["defaultQos"]
    arp = qos["arp"]
    default_qos = {
        "5qi": qos["fiveQi"],
        "arp": {
            "priorityLevel": arp["priorityLevel"],
            "preemptCap": arp["preemptCap"],
            "preemptVuln": arp["preemptVuln"],
        },
    }
    priority = qos.get("priorityLevel")
    if priority is not None:
        default_qos["priorityLevel"] = priority
    return {
        "ambr": {
            "uplink": ambr["uplink"],
            "downlink": ambr["downlink"],
        },
        "defaultQos": default_qos,
        "subscriptionSource": {
            "transactionRef": source["transactionRef"],
            "requestRef": source["requestRef"],
            "fabricRecordRef": source["fabricRecordRef"],
            "fabricRecordDigest": source["fabricRecordDigest"],
        },
    }
