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
  assertIndyLedgerConfigured,
  INDY_LEDGER_NOT_CONFIGURED,
  isIndyLedgerConfigured,
} from '../../../utils/indyLedgerGuard'
import { CredentialDefinitionController } from '../cred-def/CredentialDefinitionController'
import { SchemaController } from '../schema/SchemaController'

/** A root or tenant agent. Tenant agents share the root's `registeredModules`, so one shape covers both. */
function agentWithModules(registeredModules: Record<string, unknown>) {
  const anoncreds = {
    getSchema: jest.fn(async (schemaId: string) => ({ schemaId, schema: {}, resolutionMetadata: {} })),
    registerSchema: jest.fn(async () => ({ schemaState: { state: 'wait' } })),
    getCredentialDefinition: jest.fn(async (credentialDefinitionId: string) => ({
      credentialDefinitionId,
      credentialDefinition: {},
      resolutionMetadata: {},
    })),
    registerCredentialDefinition: jest.fn(async () => ({ credentialDefinitionState: { state: 'wait' } })),
  }
  return { dependencyManager: { registeredModules }, modules: { anoncreds } }
}

const noIndyAgent = () => agentWithModules({ askar: {}, anoncreds: {}, dids: {} })
const indyAgent = () => agentWithModules({ askar: {}, indyVdr: {}, anoncreds: {}, dids: {} })

async function expectIndyNotConfigured(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(BaseError)
  expect(error).toMatchObject({ statusCode: 501, message: 'Indy ledger is not configured' })
}

describe('Indy ledger guard', () => {
  it('detects the Indy VDR module on root and tenant agents', () => {
    expect(isIndyLedgerConfigured(indyAgent() as never)).toBe(true)
    expect(isIndyLedgerConfigured(noIndyAgent() as never)).toBe(false)
  })

  it('throws a 501 "Indy ledger is not configured" error without Indy', () => {
    expect(() => assertIndyLedgerConfigured(indyAgent() as never)).not.toThrow()
    expect(() => assertIndyLedgerConfigured(noIndyAgent() as never)).toThrow(IndyLedgerNotConfiguredError)
    expect(INDY_LEDGER_NOT_CONFIGURED).toBe('Indy ledger is not configured')
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
          issuerId: 'did:indy:bcovrin:testnet:LjgpST2rjsoxYegQDRm7EL',
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

    await expectIndyNotConfigured(
      schemaController.getSchemaById({ agent } as never, 'LjgpST2rjsoxYegQDRm7EL:2:schema:1.0' as never),
    )
    expect(agent.modules.anoncreds.getSchema).not.toHaveBeenCalled()
  })

  it('POST /anoncreds/credential-definitions answers 501 and never reaches the registry', async () => {
    const agent = noIndyAgent()

    await expectIndyNotConfigured(
      credentialDefinitionController.createCredentialDefinition(
        { agent } as never,
        {
          issuerId: 'did:indy:bcovrin:testnet:LjgpST2rjsoxYegQDRm7EL',
          schemaId: 'LjgpST2rjsoxYegQDRm7EL:2:schema:1.0',
          tag: 'default',
        } as never,
      ),
    )
    expect(agent.modules.anoncreds.registerCredentialDefinition).not.toHaveBeenCalled()
  })

  it('GET /anoncreds/credential-definitions/:id answers 501', async () => {
    const agent = noIndyAgent()

    await expectIndyNotConfigured(
      credentialDefinitionController.getCredentialDefinitionById(
        { agent } as never,
        'LjgpST2rjsoxYegQDRm7EL:3:CL:10:default' as never,
      ),
    )
    expect(agent.modules.anoncreds.getCredentialDefinition).not.toHaveBeenCalled()
  })

  it('still reaches the registry when an Indy ledger is configured', async () => {
    const agent = indyAgent()

    await schemaController.getSchemaById({ agent } as never, 'LjgpST2rjsoxYegQDRm7EL:2:schema:1.0' as never)
    await credentialDefinitionController.getCredentialDefinitionById(
      { agent } as never,
      'LjgpST2rjsoxYegQDRm7EL:3:CL:10:default' as never,
    )

    expect(agent.modules.anoncreds.getSchema).toHaveBeenCalledWith('LjgpST2rjsoxYegQDRm7EL:2:schema:1.0')
    expect(agent.modules.anoncreds.getCredentialDefinition).toHaveBeenCalledWith(
      'LjgpST2rjsoxYegQDRm7EL:3:CL:10:default',
    )
  })
})
