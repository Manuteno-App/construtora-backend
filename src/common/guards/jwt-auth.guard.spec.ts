import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const context = (authorization = 'Bearer token') => {
  const request: any = { headers: { authorization } };
  return { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => request }), request } as any;
};

describe('JwtAuthGuard', () => {
  const reflector = { getAllAndOverride: jest.fn(() => false) } as any;
  const repository = { findById: jest.fn() } as any;
  const config = { get: jest.fn((key: string) => key === 'manutenoApiBaseUrl' ? 'https://api.manuteno.test' : 'local-secret') } as any;
  let jwt: any;

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn().mockRejectedValue(new Error('not local')) };
    repository.findById.mockReset();
    global.fetch = jest.fn() as any;
  });

  it('keeps accepting the existing local JWT', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'local-user', email: 'local@test.com' });
    repository.findById.mockResolvedValue({ id: 'local-user', email: 'local@test.com', name: 'Local' });
    const guard = new JwtAuthGuard(reflector, jwt, repository, config);
    const requestContext = context();

    await expect(guard.canActivate(requestContext)).resolves.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(requestContext.request.user).toMatchObject({ source: 'construtora', id: 'local-user' });
  });

  it('accepts an administrator validated by the Portal', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ user_id: 7, username: 'admin@manuteno.com', name: 'Admin', admin: true, privileges: [1] }) });
    const guard = new JwtAuthGuard(reflector, jwt, repository, config);
    const requestContext = context('Bearer opaque-token');

    await expect(guard.canActivate(requestContext)).resolves.toBe(true);
    expect(requestContext.request.user).toMatchObject({ source: 'portal', id: '7', isAdmin: true });
  });

  it('rejects a non-administrator Portal user', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ user_id: 8, username: 'user@manuteno.com', admin: false }) });
    const guard = new JwtAuthGuard(reflector, jwt, repository, config);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed when the Portal cannot be reached', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const guard = new JwtAuthGuard(reflector, jwt, repository, config);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
