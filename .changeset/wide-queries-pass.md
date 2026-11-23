---
'agent-controller': minor
---

`POST /openid4vc/verification-sessions/create-presentation-request` accepts the whole DCQL query of OpenID4VP 1.0: claim `id` and `values`, `null` and numeric path segments, and on a credential query `multiple`, `trusted_authorities` and `claim_sets`. They were refused with 422 by request validation.
