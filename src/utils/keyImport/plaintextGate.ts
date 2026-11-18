import { BadRequestError } from '../../errors'

/** Plaintext key material fields that the encrypted import flow replaces. */
export interface PlaintextKeyMaterialFields {
  privateKey?: string
  privateKeyJwk?: Record<string, unknown>
  passphrase?: string
  privatekey?: string
}

export function allowPlaintextKeyImport(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.ALLOW_PLAINTEXT_KEY_IMPORT ?? '').trim().toLowerCase())
}

/**
 * Plaintext key import is a migration only escape hatch. The production API only accepts `encryptedKey`, so a key
 * cannot be read from request bodies, validation errors, gateway logs or the NATS payload.
 */
export function assertPlaintextKeyImportAllowed(options: PlaintextKeyMaterialFields): void {
  if (allowPlaintextKeyImport()) return
  if (options.privateKey || options.privateKeyJwk || options.passphrase || options.privatekey) {
    throw new BadRequestError(
      'Plaintext private key import is disabled. Request a key import session from POST /dids/import/session and send the encryptedKey envelope instead.',
    )
  }
}
