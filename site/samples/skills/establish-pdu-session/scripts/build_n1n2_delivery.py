# /// connectionagent-tool
# name: build-n1n2-delivery
# inputSchema: N1N2DeliveryInput
# outputSchema: N1N2Delivery
# effect: local_compute
# sandbox:
#   network: denied
# timeout: 1s
# ///

import json

class N1N2DeliveryInput(dict):
    pass

class N1N2Delivery(dict):
    pass

def main(input: N1N2DeliveryInput) -> N1N2Delivery:
    # The Skill decides which prepared N1/N2 material is delivered for this
    # attempt: the admitted SM profile and an IPv4 PDU session.  The Tool input
    # schema validates the complete request, and the transfer adapter proves
    # every selected value against its durable prepared-response record.  This
    # Script holds no address, credential, deadline, operation identity or send.
    prepared = input["preparedResponse"]
    if prepared.get("profileRef") != "createdsession-n1n2-sm@0.1.0":
        raise ValueError("prepared response is not the admitted N1/N2 SM profile")
    if input["pduSessionType"] != "IPV4":
        raise ValueError("the admitted delivery profile requires an IPv4 PDU session")
    artifact_digest = prepared.get("artifactDigest")
    if type(artifact_digest) is not str or not artifact_digest:
        raise ValueError("prepared response has no admitted N1/N2 artifact digest")
    nas_digest = prepared.get("nasDigest")
    if type(nas_digest) is not str or not nas_digest:
        raise ValueError("prepared response has no admitted N1 NAS digest")
    n2_digest = prepared.get("n2Digest")
    if type(n2_digest) is not str or not n2_digest:
        raise ValueError("prepared response has no admitted N2 NGAP digest")
    return {
        "profileRef": prepared["profileRef"],
        "responseArtifactRef": prepared["responseArtifactRef"],
        "artifactDigest": artifact_digest,
        "nasDigest": nas_digest,
        "n2Digest": n2_digest,
        "validUntil": prepared["validUntil"],
        "operationContextRef": input["operationContextRef"],
        "policyResultRef": input["policyResultRef"],
    }
