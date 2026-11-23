---
'agent-controller': patch
---

`POST /openid4vc/holder/accept-proof-request` returns the verifier's response body as `verifierResponse`, answers 400 instead of 500 when Credo cannot select credentials for the request, and, with DCQL `credential_sets` and `selectedCredentials`, presents only the option made of the chosen queries.
