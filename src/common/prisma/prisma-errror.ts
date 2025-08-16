import { Prisma } from '@prisma/client';

export function isPrismaKnownError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError;
}

export function isUniqueField(err: unknown, fields?: string[]): boolean {
  if (!isPrismaKnownError(err)) return false;
  if (err.code !== 'P2002') return false;

  const target = err.meta?.target as string[] | undefined;
  if (!fields || fields.length === 0) return true;
  return Array.isArray(target) && fields.every((f) => target.includes(f));
}
