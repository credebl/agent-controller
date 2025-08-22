import type { BaseError } from './errors/errors'

import { AnonCredsError, AnonCredsRsError, AnonCredsStoreRecordError } from '@credo-ts/anoncreds'
import {
  CredoError,
  RecordNotFoundError,
  RecordDuplicateError,
  ClassValidationError
} from '@credo-ts/core'
import { MessageSendingError } from '@credo-ts/didcomm'
import { IndyVdrError } from '@hyperledger/indy-vdr-nodejs'

import { RecordDuplicateError as CustomRecordDuplicateError, NotFoundError, InternalServerError } from './errors/errors'
import convertError from './utils/errorConverter'

class ErrorHandlingService {
  public static handle(error: unknown) {
    if (error instanceof RecordDuplicateError) {
      throw this.handleRecordDuplicateError(error)
    } else if (error instanceof ClassValidationError) {
      throw this.handleClassValidationError(error)
    } else if (error instanceof MessageSendingError) {
      throw this.handleMessageSendingError(error)
    } else if (error instanceof RecordNotFoundError) {
      throw this.handleRecordNotFoundError(error)
    } else if (error instanceof AnonCredsRsError) {
      throw this.handleAnonCredsRsError(error)
    } else if (error instanceof AnonCredsStoreRecordError) {
      throw this.handleAnonCredsStoreRecordError(error)
    } else if (error instanceof IndyVdrError) {
      throw this.handleIndyVdrError(error)
    } else if (error instanceof AnonCredsError) {
      throw this.handleAnonCredsError(error)
    } else if (error instanceof CredoError) {
      throw this.handleCredoError(error)
    } else if (error instanceof Error) {
      throw convertError(error.constructor.name, error.message)
    } else {
      throw new InternalServerError(`An unknown error occurred ${error}`)
    }
  }
  private static handleIndyVdrError(error: IndyVdrError) {
    throw new InternalServerError(`IndyVdrError: ${error.message}`)
  }

  private static handleAnonCredsError(error: AnonCredsError): BaseError {
    throw new InternalServerError(`AnonCredsError: ${error.message}`)
  }

  private static handleAnonCredsRsError(error: AnonCredsRsError): BaseError {
    throw new InternalServerError(`AnonCredsRsError: ${error.message}`)
  }

  private static handleAnonCredsStoreRecordError(error: AnonCredsStoreRecordError): BaseError {
    throw new InternalServerError(`AnonCredsStoreRecordError: ${error.message}`)
  }

  private static handleCredoError(error: CredoError): BaseError {
    throw new InternalServerError(`CredoError: ${error.message}`)
  }

  private static handleRecordNotFoundError(error: RecordNotFoundError): BaseError {
    throw new NotFoundError(error.message)
  }

  private static handleRecordDuplicateError(error: RecordDuplicateError): BaseError {
    throw new CustomRecordDuplicateError(error.message)
  }

  private static handleClassValidationError(error: ClassValidationError): BaseError {
    throw new InternalServerError(`ClassValidationError: ${error.message}`)
  }

  private static handleMessageSendingError(error: MessageSendingError): BaseError {
    throw new InternalServerError(`MessageSendingError: ${error.message}`)
  }
}

export default ErrorHandlingService
