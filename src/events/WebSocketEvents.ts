import { WebSocket, type Server } from 'ws'

export const sendWebSocketEvent = async (server: Server, data: unknown) => {
  server.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      typeof data === 'string' ? client.send(data) : client.send(JSON.stringify(data))
    }
  })
}
