import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';
import { UsersService } from './users.service';

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test', meta });

describe('UsersService', () => {
  const user = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() };
  const service = new UsersService({ user } as unknown as PrismaService);
  const payload = { email: 'alice@example.com', password: 'hash' };

  beforeEach(() => jest.resetAllMocks());

  it('findByEmail looks the user up by the unique email', async () => {
    user.findUnique.mockResolvedValue({ id: 'user-1' });
    await expect(service.findByEmail('alice@example.com')).resolves.toEqual({ id: 'user-1' });
    expect(user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@example.com' } });
  });

  it('findById looks the user up by id', async () => {
    user.findUnique.mockResolvedValue(null);
    await expect(service.findById('user-1')).resolves.toBeNull();
    expect(user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  describe('createUser', () => {
    it('creates the user with the given email and password hash', async () => {
      user.create.mockResolvedValue({ id: 'user-1', ...payload });
      await expect(service.createUser(payload)).resolves.toMatchObject({ id: 'user-1' });
      expect(user.create).toHaveBeenCalledWith({ data: payload });
    });

    it('turns a unique-email violation (registration race) into 409', async () => {
      user.create.mockRejectedValue(prismaError('P2002', { target: ['email'] }));
      await expect(service.createUser(payload)).rejects.toThrow(
        new ConflictException('Email already in use'),
      );
    });

    it.each([
      ['another unique violation', prismaError('P2002', { target: ['id'] })],
      ['another Prisma error', prismaError('P2003')],
      ['a non-Prisma error', new Error('connection lost')],
    ])('rethrows %s unchanged', async (_case, error) => {
      user.create.mockRejectedValue(error);
      await expect(service.createUser(payload)).rejects.toBe(error);
    });
  });

  it('bumpTokenVersion increments atomically and returns the new version', async () => {
    user.update.mockResolvedValue({ tokenVersion: 4 });

    await expect(service.bumpTokenVersion('user-1')).resolves.toBe(4);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
  });
});
