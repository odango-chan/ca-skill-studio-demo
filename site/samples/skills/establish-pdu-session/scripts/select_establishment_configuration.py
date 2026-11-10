# /// connectionagent-tool
# name: select-establishment-configuration
# inputSchema: EstablishmentSelectionInput
# outputSchema: EstablishmentSelection
# effect: local_compute
# sandbox:
#   network: denied
# timeout: 1s
# ///

import json

class EstablishmentSelectionInput(dict):
    pass

class EstablishmentSelection(dict):
    pass

def main(input: EstablishmentSelectionInput) -> EstablishmentSelection:
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
