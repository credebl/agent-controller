import { bindW3cCredentialSubject } from '../w3cCredentialSubject'

// Avoid loading Credo's ESM/native dependencies in Jest; only the symbols the helper touches are stubbed.
jest.mock('@credo-ts/core', () => {
  const tryParseDid = (didUrl: string) => {
    if (!didUrl.startsWith('did:')) return undefined
    const [did, fragment] = didUrl.split('#')
    return { did, method: did.split(':')[1], fragment, didUrl }
  }
  return {
    CredoError: class CredoError extends Error {},
    tryParseDid,
    parseDid: (didUrl: string) => {
      const parsed = tryParseDid(didUrl)
      if (!parsed) throw new Error(`Error parsing did '${didUrl}'`)
      return parsed
    },
  }
})

const DID_KEY = 'did:key:z6MkgPfcExample'
const DID_WEB = 'did:web:holder.example.com'

describe('bindW3cCredentialSubject', () => {
  it('uses the bare did:key, not the verification method url', () => {
    const result = bindW3cCredentialSubject({ name: 'Acme' }, `${DID_KEY}#z6MkgPfcExample`)
    expect(result).toEqual({ credentialSubject: { name: 'Acme', id: DID_KEY }, subjectId: DID_KEY })
  })

  it('uses the bare did:web for a #key-1 binding', () => {
    expect(bindW3cCredentialSubject({ name: 'Acme' }, `${DID_WEB}#key-1`).subjectId).toBe(DID_WEB)
  })

  it('normalises a payload subject id of the same DID', () => {
    const result = bindW3cCredentialSubject({ id: `${DID_WEB}#key-1`, name: 'Acme' }, `${DID_WEB}#key-1`)
    expect(result.credentialSubject).toEqual({ id: DID_WEB, name: 'Acme' })
  })

  it('rejects a payload subject id of another DID', () => {
    expect(() => bindW3cCredentialSubject({ id: 'did:web:example.com' }, `${DID_WEB}#key-1`)).toThrow(
      /does not match the DID the holder proved possession of/,
    )
  })

  it('rejects a non-DID payload subject id when the holder proved a DID', () => {
    expect(() => bindW3cCredentialSubject({ id: 'urn:uuid:1234' }, `${DID_WEB}#key-1`)).toThrow(
      /does not match the DID/,
    )
  })

  it('binds subjects without an id and keeps other subjects of an array', () => {
    const result = bindW3cCredentialSubject([{ id: 'did:web:other.example' }, { role: 'director' }], `${DID_WEB}#key-1`)
    expect(result.credentialSubject).toEqual([{ id: 'did:web:other.example' }, { role: 'director', id: DID_WEB }])
    expect(result.subjectId).toBe('did:web:other.example')
  })

  it('rejects an array with no subject that is the holder', () => {
    expect(() => bindW3cCredentialSubject([{ id: 'did:web:other.example' }], `${DID_WEB}#key-1`)).toThrow(
      /No credentialSubject is the DID/,
    )
  })

  it('keeps the payload as is without a DID binding', () => {
    expect(bindW3cCredentialSubject({ id: 'urn:uuid:1234' }, undefined)).toEqual({
      credentialSubject: { id: 'urn:uuid:1234' },
      subjectId: 'urn:uuid:1234',
    })
  })
})
