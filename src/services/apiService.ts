import { injectable } from 'tsyringe'

@injectable()
export class ApiService {
  public async postRequest<T, R>(url: string, payload: T, apiKey: string): Promise<R> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Failed to make POST request. Status code: ${response.status}`)
      }

      return (await response.json()) as R
    } catch (error) {
      throw new Error(`Error making POST request: ${error}`)
    }
  }

  public async getRequest(url: string, apiKey?: string): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }

    if (apiKey) {
      headers['x-api-key'] = apiKey
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        throw new Error(`Failed to make GET request. Status code: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      throw new Error(`Error making GET request: ${error}`)
    }
  }

  public async putRequest<T>(url: string, payload: T, apiKey: string): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    }

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Failed to make PUT request. Status code: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      throw new Error(`Error making PUT request: ${error}`)
    }
  }

  public async patchRequest<T>(url: string, payload: T, apiKey: string): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    }

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Failed to make PATCH request. Status code: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      throw new Error(`Error making PATCH request: ${error}`)
    }
  }
}
