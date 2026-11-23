---
'agent-controller': minor
---

`POST /openid4vc/holder/accept-proof-request` accepts optional `selectedCredentials`, a map of Presentation Exchange input descriptor ids to the credential to present, so callers can choose which credential answers each request. `@openid4vc/openid4vp` is now a direct dependency.
