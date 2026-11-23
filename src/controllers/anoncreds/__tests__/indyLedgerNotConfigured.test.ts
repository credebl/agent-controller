import 'reflect-metadata'

// Credo ships as ESM only. Only the symbols these controllers and the real ErrorHandlingService touch are stubbed.
jest.mock('@credo-ts/core', () => {
  class CredoError extends Error {}
  return {
    Agent: class Agent {},
    CredoError,
    RecordNotFoundError: class RecordNotFoundError extends CredoError {},
    RecordDuplicateError: class RecordDuplicateError extends CredoError {},
    ClassValidationError: class ClassValidationError extends CredoError {},
  }
})
jest.mock('@credo-ts/anoncreds', () => ({
  AnonCredsError: class AnonCredsError extends Error {},
  AnonCredsRsError: class AnonCredsRsError extends Error {},
  AnonCredsStoreRecordError: class AnonCredsStoreRecordError extends Error {},
  getUnqualifiedSchemaId: jest.fn(),
  parseIndySchemaId: jest.fn(),
  getUnqualifiedCredentialDefinitionId: jest.fn(),
  parseIndyCredentialDefinitionId: jest.fn(),
}))
jest.mock('@credo-ts/didcomm', () => ({ MessageSendingError: class MessageSendingError extends Error {} }))
jest.mock('@hyperledger/indy-vdr-nodejs', () => ({ IndyVdrError: class IndyVdrError extends Error {} }))
jest.mock('../../../cliAgent', () => ({}))

import ErrorHandlingService from '../../../errorHandlingService'
import { BaseError, IndyLedgerNotConfiguredError } from '../../../errors/errors'
import {
  assertAnonCredsIdentifiersServed,
  assertIndyDidRegistrar,
  hasIndyDidRegistrar,
  INDY_LEDGER_NOT_CONFIGURED,
  INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER,
} from '../../../utils/indyLedgerGuard'
import { CredentialDefinitionController } from '../cred-def/CredentialDefinitionController'
import { SchemaController } from '../schema/SchemaController'

// Simplified identifier patterns; the real ones come from @credo-ts/anoncreds.
const indyIdentifier = /^did:indy:|^[a-zA-Z0-9]{21,22}:[234]:/
const placeholderIndyRegistry = {
  supportedIdentifier: indyIdentifier,
  [INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER]: true,
}
const indyRegistry = { supportedIdentifier: indyIdentifier }
const webRegistry = { supportedIdentifier: /^did:web:/ }

/** A root or tenant agent; both expose the same `dids` and `anoncreds` config. */
function agentWith({ registries, didMethods }: { registries: object[]; didMethods: string[] }) {
  const anoncreds = {
    config: { registries },
    getSchema: jest.fn(async (schemaId: string) => ({ schemaId, schema: {}, resolutionMetadata: {} })),
    registerSchema: jest.fn(async () => ({ schemaState: { state: 'wait' } })),
    getCredentialDefinition: jest.fn(async (credentialDefinitionId: string) => ({
      credentialDefinitionId,
      credentialDefinition: {},
      resolutionMetadata: {},
    })),
    registerCredentialDefinition: jest.fn(async () => ({ credentialDefinitionState: { state: 'wait' } })),
  }
  const registrars = didMethods.map((method) => ({ supportedMethods: [method] }))
  return { dids: { config: { registrars } }, modules: { anoncreds } }
}

// As started by this controller without a ledger, and an embedder's agent with a did:web AnonCreds registry.
const noIndyAgent = () => agentWith({ registries: [placeholderIndyRegistry], didMethods: ['key', 'web'] })
const webOnlyAgent = () => agentWith({ registries: [webRegistry], didMethods: ['web'] })
const indyAgent = () => agentWith({ registries: [indyRegistry], didMethods: ['indy', 'key', 'web'] })

const indyIssuer = 'did:indy:bcovrin:testnet:LjgpST2rjsoxYegQDRm7EL'
const indySchemaId = 'LjgpST2rjsoxYegQDRm7EL:2:schema:1.0'
const indyCredDefId = 'LjgpST2rjsoxYegQDRm7EL:3:CL:10:default'

async function expectIndyNotConfigured(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(BaseError)
  expect(error).toMatchObject({ statusCode: 501, message: 'Indy ledger is not configured' })
}

describe('Indy ledger guard', () => {
  it('looks for a did:indy registrar, whatever key the Indy module is registered under', () => {
    expect(hasIndyDidRegistrar(indyAgent() as never)).toBe(true)
    expect(hasIndyDidRegistrar(noIndyAgent() as never)).toBe(false)
    expect(() => assertIndyDidRegistrar(indyAgent() as never)).not.toThrow()
    expect(() => assertIndyDidRegistrar(noIndyAgent() as never)).toThrow(IndyLedgerNotConfiguredError)
    expect(INDY_LEDGER_NOT_CONFIGURED).toBe('Indy ledger is not configured')
  })

  it('rejects only identifiers the placeholder registry would serve', () => {
    expect(() => assertAnonCredsIdentifiersServed(noIndyAgent() as never, [indyIssuer])).toThrow(
      IndyLedgerNotConfiguredError,
    )
    expect(() => assertAnonCredsIdentifiersServed(noIndyAgent() as never, ['did:web:example.com'])).not.toThrow()
    expect(() => assertAnonCredsIdentifiersServed(indyAgent() as never, [indyIssuer, indySchemaId])).not.toThrow()
    expect(() => assertAnonCredsIdentifiersServed(webOnlyAgent() as never, ['did:web:example.com'])).not.toThrow()
    expect(() => assertAnonCredsIdentifiersServed(noIndyAgent() as never, [undefined])).not.toThrow()
  })

  it('leaves lastIndex of global or sticky registry expressions unchanged', () => {
    const globalWeb = { supportedIdentifier: /^did:web:/g }
    const stickyIndy = { supportedIdentifier: /did:indy:/y, [INDY_LEDGER_NOT_CONFIGURED_REGISTRY_MARKER]: true }
    const agent = agentWith({ registries: [globalWeb, stickyIndy], didMethods: ['web'] })

    expect(() => assertAnonCredsIdentifiersServed(agent as never, ['did:web:example.com'])).not.toThrow()
    expect(globalWeb.supportedIdentifier.lastIndex).toBe(0)
    // Credo's own selection, which runs next, still matches.
    expect(globalWeb.supportedIdentifier.test('did:web:example.com')).toBe(true)

    expect(() => assertAnonCredsIdentifiersServed(agent as never, [indyIssuer])).toThrow(IndyLedgerNotConfiguredError)
    expect(stickyIndy.supportedIdentifier.lastIndex).toBe(0)
  })

  it('keeps the 501 through ErrorHandlingService', () => {
    let handled: unknown
    try {
      ErrorHandlingService.handle(new IndyLedgerNotConfiguredError(INDY_LEDGER_NOT_CONFIGURED))
    } catch (error) {
      handled = error
    }
    expect(handled).toMatchObject({ statusCode: 501, message: 'Indy ledger is not configured' })
  })
})

describe('AnonCreds routes without an Indy ledger', () => {
  const schemaController = new SchemaController()
  const credentialDefinitionController = new CredentialDefinitionController()

  it('POST /anoncreds/schemas answers 501 and never reaches the registry', async () => {
    const agent = noIndyAgent()

    await expectIndyNotConfigured(
      schemaController.createSchema(
        { agent } as never,
        {
          issuerId: indyIssuer,
          name: 'schema',
          version: '1.0',
          attributes: ['name'],
        } as never,
      ),
    )
    expect(agent.modules.anoncreds.registerSchema).not.toHaveBeenCalled()
  })

  it('GET /anoncreds/schemas/:id answers 501', async () => {
    const agent = noIndyAgent()

    await expectIndyNotConfigured(schemaController.getSchemaById({ agent } as never, indySchemaId as never))
    expect(agent.modules.anoncreds.getSchema).not.toHaveBeenCalled()
  })

  it('POST /anoncreds/credential-definitions answers 501 and never reaches the registry', async () => {
    const agent = noIndyAgent()

    await expectIndyNotConfigured(
      credentialDefinitionController.createCredentialDefinition(
        { agent } as never,
        {
          issuerId: indyIssuer,
          schemaId: indySchemaId,
          tag: 'default',
        } as never,
      ),
    )
    expect(agent.modules.anoncreds.registerCredentialDefinition).not.toHaveBeenCalled()
  })

  it('GET /anoncreds/credential-definitions/:id answers 501', async () => {
    const agent = noIndyAgent()

    await expectIndyNotConfigured(
      credentialDefinitionController.getCredentialDefinitionById({ agent } as never, indyCredDefId as never),
    )
    expect(agent.modules.anoncreds.getCredentialDefinition).not.toHaveBeenCalled()
  })

  it('still reaches the registry when an Indy ledger is configured', async () => {
    const agent = indyAgent()

    await schemaController.getSchemaById({ agent } as never, indySchemaId as never)
    await credentialDefinitionController.getCredentialDefinitionById({ agent } as never, indyCredDefId as never)

    expect(agent.modules.anoncreds.getSchema).toHaveBeenCalledWith(indySchemaId)
    expect(agent.modules.anoncreds.getCredentialDefinition).toHaveBeenCalledWith(indyCredDefId)
  })

  it('lets a non-Indy registry serve schemas and credential definitions without an Indy ledger', async () => {
    const agent = webOnlyAgent()
    const webIssuer = 'did:web:example.com'

    await schemaController.getSchemaById({ agent } as never, 'did:web:example.com/schema' as never)
    await schemaController.createSchema(
      { agent } as never,
      {
        issuerId: webIssuer,
        name: 'schema',
        version: '1.0',
        attributes: ['name'],
        endorse: true,
        endorserDid: webIssuer,
      } as never,
    )
    await credentialDefinitionController.getCredentialDefinitionById(
      { agent } as never,
      'did:web:example.com/creddef' as never,
    )
    await credentialDefinitionController.createCredentialDefinition(
      { agent } as never,
      {
        issuerId: webIssuer,
        schemaId: 'did:web:example.com/schema',
        tag: 'default',
        endorse: true,
        endorserDid: webIssuer,
      } as never,
    )

    expect(agent.modules.anoncreds.getSchema).toHaveBeenCalled()
    expect(agent.modules.anoncreds.registerSchema).toHaveBeenCalled()
    expect(agent.modules.anoncreds.getCredentialDefinition).toHaveBeenCalled()
    expect(agent.modules.anoncreds.registerCredentialDefinition).toHaveBeenCalled()
  })

  it('answers 501 for a credential definition on an Indy schema even with a non-Indy issuer', async () => {
    const agent = noIndyAgent()

    await expectIndyNotConfigured(
      credentialDefinitionController.createCredentialDefinition(
        { agent } as never,
        {
          issuerId: 'did:web:example.com',
          schemaId: indySchemaId,
          tag: 'default',
          endorse: true,
          endorserDid: 'did:web:example.com',
        } as never,
      ),
    )
    expect(agent.modules.anoncreds.registerCredentialDefinition).not.toHaveBeenCalled()
  })
})
