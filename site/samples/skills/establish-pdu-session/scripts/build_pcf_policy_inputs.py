# /// connectionagent-tool
# name: build-pcf-policy-inputs
# inputSchema: PcfPolicyInputsInput
# outputSchema: PcfPolicyInputs
# effect: local_compute
# sandbox:
#   network: denied
# timeout: 1s
# ///

import json

class PcfPolicyInputsInput(dict):
    pass

class PcfPolicyInputs(dict):
    pass

def main(input: PcfPolicyInputsInput) -> PcfPolicyInputs:
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
