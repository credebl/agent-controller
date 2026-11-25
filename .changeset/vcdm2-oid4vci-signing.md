---
"agent-controller": patch
---

Fix OID4VCI issuance of VCDM 2.0 W3C credentials (`credentialVersion: v2.0`). The issuer failed with `server_error` because Credo's OID4VCI issuer signs `ldp_vc` and `jwt_vc_json-ld` through the VCDM 1.1 service only. A patch to `@credo-ts/openid4vc` now signs a VCDM 2.0 `jwt_vc_json-ld` credential as a `vc+jwt` and calls the agent's own Data Integrity signer for `ldp_vc`. Adds the `test:oid4vci-v2` smoke test.
