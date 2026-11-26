---
"agent-controller": patch
---

Fix OID4VCI issuance of VCDM 2.0 W3C credentials (`credentialVersion: v2.0`), which failed with `server_error` because Credo's OID4VCI issuer signs `ldp_vc` and `jwt_vc_json(-ld)` through the VCDM 1.1 service only. A patch to `@credo-ts/openid4vc` (the same change proposed upstream) lets the issuer sign a `W3cV2Credential` as a `vc+jwt` or, for `ldp_vc`, with a Data Integrity proof (`eddsa-jcs-2022`), and lets the holder verify and store both. Adds the `test:oid4vci-v2` smoke test.
