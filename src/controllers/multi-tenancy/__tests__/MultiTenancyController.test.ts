import 'reflect-metadata'

jest.mock('@credo-ts/core', () => ({
  Agent: class {},
  JsonTransformer: { toJSON: (value: unknown) => value },
  RecordNotFoundError: class RecordNotFoundError extends Error {},
  injectable: () => (target: unknown) => target,
}))

jest.mock('../../../errorHandlingService', () => ({
  __esModule: true,
  default: { handle: (error: unknown) => error },
}))

import { MultiTenancyController } from '../MultiTenancyController'

describe('MultiTenancyController.deleteTenantById', () => {
  it("purges the tenant's OpenBao keys before deleting the tenant", async () => {
    const calls: string[] = []
    const agent = {
      modules: {
        openBao: {
          purgeTenant: jest.fn(async (tenantId: string) => {
            calls.push(`purge:${tenantId}`)
            return 1
          }),
        },
        tenants: {
          deleteTenantById: jest.fn(async (tenantId: string) => {
            calls.push(`delete:${tenantId}`)
            return { id: tenantId }
          }),
        },
      },
    }

    const controller = new MultiTenancyController()
    const result = await controller.deleteTenantById(
      { agent } as never,
      'tenant-1',
      (status: number, body: unknown) => ({ status, body }),
      (status: number, body: unknown) => ({ status, body }),
    )

    expect(result).toEqual({ id: 'tenant-1' })
    expect(calls).toEqual(['purge:tenant-1', 'delete:tenant-1'])
  })

  it('does not delete the tenant when the OpenBao purge fails', async () => {
    const agent = {
      modules: {
        openBao: { purgeTenant: jest.fn().mockRejectedValue(new Error('OpenBao is sealed')) },
        tenants: { deleteTenantById: jest.fn() },
      },
    }

    const controller = new MultiTenancyController()
    const internalServerError = jest.fn((status: number, body: unknown) => ({ status, body }))

    const result = await controller.deleteTenantById(
      { agent } as never,
      'tenant-1',
      (status: number, body: unknown) => ({ status, body }),
      internalServerError,
    )

    expect(agent.modules.tenants.deleteTenantById).not.toHaveBeenCalled()
    expect(internalServerError).toHaveBeenCalledWith(500, expect.objectContaining({ message: expect.any(String) }))
    expect(result).toMatchObject({ status: 500 })
  })
})
