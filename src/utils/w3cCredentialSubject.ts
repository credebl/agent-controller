import { CredoError, parseDid, tryParseDid } from '@credo-ts/core'

/**
 * Sets the W3C `credentialSubject.id` to the holder's bare DID.
 *
 * The holder proves possession with a key (`binding.didUrl` is the `kid` of the proof JWT, a verification
 * method URL such as `did:key:z6Mk…#z6Mk…`), but the subject is the DID itself (W3C VCDM). A subject id
 * from the payload must name the same DID; otherwise the holder could not present the credential.
 *
 * For several subjects, subjects without an id are given the holder DID and at least one subject must be
 * the holder.
 */
export function bindW3cCredentialSubject(
  credentialSubject: unknown,
  bindingDidUrl: string | undefined,
): { credentialSubject: any; subjectId: string | undefined } {
  const holderDid = bindingDidUrl ? parseDid(bindingDidUrl).did : undefined
  const subjects = Array.isArray(credentialSubject) ? credentialSubject : [credentialSubject ?? {}]

  const bound = subjects.map((subject: any) => {
    if (!subject || typeof subject !== 'object') return subject
    if (!holderDid) return { ...subject }
    if (subject.id === undefined || subject.id === null || subject.id === '') return { ...subject, id: holderDid }

    const subjectDid = typeof subject.id === 'string' ? tryParseDid(subject.id)?.did : undefined
    // Only one subject has to be the holder when there are several
    if (subjectDid !== holderDid && Array.isArray(credentialSubject)) return { ...subject }
    if (subjectDid !== holderDid) {
      throw new CredoError(
        `credentialSubject.id '${subject.id}' does not match the DID the holder proved possession of ('${holderDid}')`,
      )
    }
    return { ...subject, id: holderDid }
  })

  if (holderDid && !bound.some((subject: any) => subject?.id === holderDid)) {
    throw new CredoError(`No credentialSubject is the DID the holder proved possession of ('${holderDid}')`)
  }

  const subjectId = bound.find((subject: any) => subject?.id)?.id
  return { credentialSubject: Array.isArray(credentialSubject) ? bound : bound[0], subjectId }
}
