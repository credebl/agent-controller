// import type { IndyVdrDidCreateOptions } from '@credo-ts/indy-vdr'

// import {
//   getUnqualifiedCredentialDefinitionId,
//   getUnqualifiedSchemaId,
//   parseIndyCredentialDefinitionId,
//   parseIndySchemaId,
// } from '@credo-ts/anoncreds'
// import { Request as Req } from 'express'
// import { Body, Controller, Post, Route, Tags, Security, Request } from 'tsoa'
// import { injectable } from 'tsyringe'

// import { CredentialEnum, EndorserMode, SCOPES } from '../../../enums'
// import ErrorHandlingService from '../../../errorHandlingService'
// import { BadRequestError } from '../../../errors'
// import { AgentType } from '../../../types'
// import { DidNymTransaction, EndorserTransaction, WriteTransaction } from '../../types'

// @Tags('Anoncreds - EndorserTransaction')
// @Route('/anoncreds/transactions')
// @Security('jwt', [SCOPES.TENANT_AGENT, SCOPES.DEDICATED_AGENT])
// @injectable()
// export class EndorserTransactionController extends Controller {
//   @Post('/endorse')
//   public async endorserTransaction(@Request() request: Req, @Body() endorserTransaction: EndorserTransaction) {
//     try {
//       if (!endorserTransaction.transaction) {
//         throw new BadRequestError('Transaction is required')
//       }
//       if (!endorserTransaction.endorserDid) {
//         throw new BadRequestError('EndorserDid is required')
//       }
//       const signedTransaction = await request.agent.modules.indyVdr.endorseTransaction(
//         endorserTransaction.transaction,
//         endorserTransaction.endorserDid,
//       )

//       return { signedTransaction }
//     } catch (error) {
//       throw ErrorHandlingService.handle(error)
//     }
//   }

//   @Post('/set-endorser-role')
//   public async didNymTransaction(@Request() request: Req, @Body() didNymTransaction: DidNymTransaction) {
//     try {
//       const didCreateSubmitResult = await request.agent.dids.create<IndyVdrDidCreateOptions>({
//         did: didNymTransaction.did,
//         options: {
//           endorserMode: EndorserMode.External,
//           endorsedTransaction: {
//             nymRequest: didNymTransaction.nymRequest,
//           },
//         },
//       })

//       // Importing did in accordance to the multi-tenant flow
//       await request.agent.dids.import({
//         did: didNymTransaction.did,
//         overwrite: true,
//       })

//       return didCreateSubmitResult
//     } catch (error) {
//       throw ErrorHandlingService.handle(error)
//     }
//   }

//   @Post('/write')
//   public async writeSchemaAndCredDefOnLedger(
//     @Request() request: Req,
//     @Body()
//     writeTransaction: WriteTransaction,
//   ) {
//     try {
//       if (writeTransaction.schema) {
//         const writeSchema = await this.submitSchemaOnLedger(
//           request.agent,
//           writeTransaction.schema,
//           writeTransaction.endorsedTransaction,
//         )
//         return writeSchema
//       } else if (writeTransaction.credentialDefinition) {
//         const writeCredDef = await this.submitCredDefOnLedger(
//           request.agent,
//           writeTransaction.credentialDefinition,
//           writeTransaction.endorsedTransaction,
//         )
//         return writeCredDef
//       } else {
//         throw new Error('Please provide valid schema or credential-def!')
//       }
//     } catch (error) {
//       throw ErrorHandlingService.handle(error)
//     }
//   }

//   public async submitSchemaOnLedger(
//     agent: AgentType,
//     schema: {
//       issuerId: string
//       name: string
//       version: string
//       attributes: string[]
//     },
//     endorsedTransaction?: string,
//   ) {
//     if (!schema.issuerId) {
//       throw new BadRequestError('IssuerId is required')
//     }
//     if (!schema.name) {
//       throw new BadRequestError('Name is required')
//     }
//     if (!schema.version) {
//       throw new BadRequestError('Version is required')
//     }
//     if (!schema.attributes) {
//       throw new BadRequestError('Attributes is required')
//     }
//     const { issuerId, name, version, attributes } = schema
//     const { schemaState } = await agent.modules.anoncreds.registerSchema({
//       options: {
//         endorserMode: EndorserMode.External,
//         endorsedTransaction,
//       },
//       schema: {
//         attrNames: attributes,
//         issuerId: issuerId,
//         name: name,
//         version: version,
//       },
//     })

//     if (!schemaState.schemaId) {
//       throw new Error('Schema not created')
//     }
//     const indySchemaId = parseIndySchemaId(schemaState.schemaId)
//     const getSchemaUnqualifiedId = await getUnqualifiedSchemaId(
//       indySchemaId.namespaceIdentifier,
//       indySchemaId.schemaName,
//       indySchemaId.schemaVersion,
//     )
//     if (schemaState.state === CredentialEnum.Finished || schemaState.state === CredentialEnum.Action) {
//       schemaState.schemaId = getSchemaUnqualifiedId
//     }
//     return schemaState
//   }

//   public async submitCredDefOnLedger(
//     agent: AgentType,
//     credentialDefinition: {
//       schemaId: string
//       issuerId: string
//       tag: string
//       value: unknown
//       type: string
//     },
//     endorsedTransaction?: string,
//   ) {
//     if (!credentialDefinition.schemaId) {
//       throw new BadRequestError('SchemaId is required')
//     }
//     if (!credentialDefinition.issuerId) {
//       throw new BadRequestError('IssuerId is required')
//     }
//     if (!credentialDefinition.tag) {
//       throw new BadRequestError('Tag is required')
//     }
//     if (!credentialDefinition.value) {
//       throw new BadRequestError('Value is required')
//     }
//     if (!credentialDefinition.type) {
//       throw new BadRequestError('Type is required')
//     }
//     const { credentialDefinitionState } = await agent.modules.anoncreds.registerCredentialDefinition({
//       credentialDefinition,
//       options: {
//         endorserMode: EndorserMode.External,
//         endorsedTransaction: endorsedTransaction,
//         // Keep false for now
//         supportRevocation: false,
//       },
//     })

//     if (!credentialDefinitionState.credentialDefinitionId) {
//       throw Error('Credential Definition Id not found')
//     }

//     const indyCredDefId = parseIndyCredentialDefinitionId(credentialDefinitionState.credentialDefinitionId)
//     const getCredentialDefinitionId = await getUnqualifiedCredentialDefinitionId(
//       indyCredDefId.namespaceIdentifier,
//       indyCredDefId.schemaSeqNo,
//       indyCredDefId.tag,
//     )
//     if (
//       credentialDefinitionState.state === CredentialEnum.Finished ||
//       credentialDefinitionState.state === CredentialEnum.Action
//     ) {
//       credentialDefinitionState.credentialDefinitionId = getCredentialDefinitionId
//     }
//     return credentialDefinitionState
//   }
// }
