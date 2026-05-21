import type { ILogObject } from 'tslog'

import { LogLevel, BaseLogger } from '@credo-ts/core'
import { appendFileSync } from 'fs'
import { Logger } from 'tslog'

import { otelLogger } from '../tracer'

function logToTransport(logObject: ILogObject) {
  appendFileSync('logs.txt', JSON.stringify(logObject) + '\n')
}

export class TsLogger extends BaseLogger {
  private logger: Logger

  // Map our log levels to tslog levels
  private tsLogLevelMap = {
    [LogLevel.Test]: 'silly',
    [LogLevel.Trace]: 'trace',
    [LogLevel.Debug]: 'debug',
    [LogLevel.Info]: 'info',
    [LogLevel.Warn]: 'warn',
    [LogLevel.Error]: 'error',
    [LogLevel.Fatal]: 'fatal',
  } as const

  public constructor(logLevel: LogLevel, name: string = 'credo-controller-service' as string) {
    super(logLevel)

    this.logger = new Logger({
      name,
      minLevel: this.logLevel === LogLevel.Off ? undefined : this.tsLogLevelMap[this.logLevel as Exclude<LogLevel, LogLevel.Off>],
      ignoreStackLevels: 5,
      attachedTransports: [
        {
          transportLogger: {
            silly: logToTransport,
            debug: logToTransport,
            trace: logToTransport,
            info: logToTransport,
            warn: logToTransport,
            error: logToTransport,
            fatal: logToTransport,
          },
          // always log to file
          minLevel: 'silly',
        },
      ],
    })
  }

  private log(
    level: Exclude<LogLevel, LogLevel.Off>,
    message: string | { message: string },
    data?: Record<string, any>,
  ): void {
    const tsLogLevel = this.tsLogLevelMap[level]

    if (data) {
      this.logger[tsLogLevel](message, data)
    } else {
      this.logger[tsLogLevel](message)
    }
    let logMessage = ''
    if (typeof message === 'string') {
      logMessage = message
    } else if (typeof message === 'object' && 'message' in message) {
      logMessage = message.message
    }

    let errorDetails
    if (data?.error) {
      const error = data.error
      if (typeof error === 'string') {
        errorDetails = error
      } else if (error instanceof Error) {
        errorDetails = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      } else {
        try {
          errorDetails = JSON.parse(JSON.stringify(error))
        } catch {
          errorDetails = String(error)
        }
      }
    }
    otelLogger.emit({
      body: logMessage,
      severityText: LogLevel[level].toUpperCase(),
      attributes: {
        ...(data || {}),
        ...(errorDetails ? { error: errorDetails } : {}),
      },
    })
  }

  public test(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Test, message, data)
  }

  public trace(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Trace, message, data)
  }

  public debug(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Debug, message, data)
  }

  public info(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Info, message, data)
  }

  public warn(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Warn, message, data)
  }

  public error(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Error, message, data)
  }

  public fatal(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Fatal, message, data)
  }
}
