class BaseError extends Error {
  public statusCode: number

  public constructor(message: string, statusCode: number) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}

class InternalServerError extends BaseError {
  public constructor(message: string = 'Internal Server Error') {
    super(message, 500)
  }
}

class NotFoundError extends BaseError {
  public constructor(message: string = 'Not Found') {
    super(message, 404)
  }
}

class BadRequestError extends BaseError {
  public constructor(message: string = 'Bad Request') {
    super(message, 400)
  }
}

class UnauthorizedError extends BaseError {
  public constructor(message: string = 'Unauthorized') {
    super(message, 401)
  }
}

class PaymentRequiredError extends BaseError {
  public constructor(message: string = 'Payment Required') {
    super(message, 402)
  }
}

class ForbiddenError extends BaseError {
  public constructor(message: string = 'Forbidden') {
    super(message, 403)
  }
}

class ConflictError extends BaseError {
  public constructor(message: string = 'Conflict') {
    super(message, 409)
  }
}

class UnprocessableEntityError extends BaseError {
  public constructor(message: string = 'Unprocessable Entity') {
    super(message, 422)
  }
}

class LedgerNotFoundError extends NotFoundError {
  public constructor(message: string = 'Ledger Not Found') {
    super(message)
  }
}

class LedgerInvalidTransactionError extends BadRequestError {
  public constructor(message: string = 'Ledger Invalid Transaction') {
    super(message)
  }
}

class CommonInvalidStructureError extends BadRequestError {
  public constructor(message: string = 'Common Invalid Structure') {
    super(message)
  }
}

class RecordDuplicateError extends ConflictError {
  public constructor(message: string = 'RecordDuplicateError') {
    super(message)
  }
}

class NotImplementedError extends BaseError {
  public constructor(message: string = 'Not Implemented') {
    super(message, 501)
  }
}

/** Thrown by routes that need an Indy ledger when the agent was started without one. */
class IndyLedgerNotConfiguredError extends NotImplementedError {
  public constructor(message: string = 'Indy ledger is not configured') {
    super(message)
  }
}

const errorMap: Record<string, new (message: string) => BaseError> = {
  InternalServerError,
  NotFoundError,
  BadRequestError,
  LedgerNotFoundError,
  LedgerInvalidTransactionError,
  CommonInvalidStructureError,
  UnauthorizedError,
  PaymentRequiredError,
  ForbiddenError,
  ConflictError,
  RecordDuplicateError,
  UnprocessableEntityError,
  NotImplementedError,
  IndyLedgerNotConfiguredError,
}

export {
  InternalServerError,
  NotFoundError,
  BadRequestError,
  LedgerNotFoundError,
  LedgerInvalidTransactionError,
  CommonInvalidStructureError,
  UnauthorizedError,
  PaymentRequiredError,
  ForbiddenError,
  ConflictError,
  BaseError,
  RecordDuplicateError,
  UnprocessableEntityError,
  NotImplementedError,
  IndyLedgerNotConfiguredError,
  errorMap,
}
