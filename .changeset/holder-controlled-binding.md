---
'agent-controller': minor
---

Add holder-controlled OID4VC credential binding to the request-credential endpoint: fresh-key and existing-DID modes with DID method, proof algorithm, and policy selection, validated before token redemption. Fix fresh-key KMS selection so RSA/P-521 and OpenBao keys no longer force the Askar backend.
