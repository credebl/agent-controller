---
'agent-controller': patch
---

Upgrade Credo to 0.7.5 (a patch release of the 0.7 line). It fixes DCQL queries for `ldp_vc` credentials, makes presentation exchange accept only submission descriptors that point at the presentation's own credentials, rejects OpenID4VP requests whose `transactionData` names a credential id that is not in the query, accepts padded base64 signature decorators in DIDComm, and pins `@owf/mdoc` below 0.8.3. The `@credo-ts/core` patch no longer carries the DCQL `ldp_vc` fix, which is now part of Credo.
