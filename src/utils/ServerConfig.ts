import type { Express } from 'express'
import type { Server } from 'ws'
import type { RetentionConfig } from '../types/RetentionTypes'

export interface ServerConfig {
  port: number
  cors?: boolean
  app?: Express
  webhookUrl?: string
  /* Socket server is used for sending events over websocket to clients */
  socketServer?: Server
  schemaFileServerURL?: string
  retention?: RetentionConfig
}
