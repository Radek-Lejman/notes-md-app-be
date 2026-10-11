import { Prisma } from '@prisma/client';
import { isPrismaKnownError, isUniqueField } from './prisma-errror.util';

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test', meta });

describe('isPrismaKnownError', () => {
  it('recognizes known Prisma request errors only', () => {
    expect(isPrismaKnownError(prismaError('P2002'))).toBe(true);
    expect(isPrismaKnownError(new Error('P2002'))).toBe(false);
    expect(isPrismaKnownError({ code: 'P2002' })).toBe(false);
    expect(isPrismaKnownError(undefined)).toBe(false);
  });
});

describe('isUniqueField', () => {
  const unique = prismaError('P2002', { target: ['email', 'tenantId'] });

  it('matches any unique violation when no fields are given', () => {
    expect(isUniqueField(unique)).toBe(true);
    expect(isUniqueField(unique, [])).toBe(true);
  });

  it('matches when every given field is part of the violated constraint', () => {
    expect(isUniqueField(unique, ['email'])).toBe(true);
    expect(isUniqueField(unique, ['email', 'tenantId'])).toBe(true);
  });

  it('does not match a constraint on other fields', () => {
    expect(isUniqueField(unique, ['email', 'id'])).toBe(false);
  });

  it('does not match when Prisma gives no target list', () => {
    expect(isUniqueField(prismaError('P2002'), ['email'])).toBe(false);
    expect(isUniqueField(prismaError('P2002', { target: 'User_email_key' }), ['email'])).toBe(
      false,
    );
  });

  it('does not match other errors', () => {
    expect(isUniqueField(prismaError('P2025'), ['email'])).toBe(false);
    expect(isUniqueField(new Error('unique'), ['email'])).toBe(false);
  });
});
