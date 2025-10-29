import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { UserLogin, User } from './interfaces/user.interface';
import { isUniqueField } from 'src/infrastructure/database/prisma/prisma-errror.util';
import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(private readonly prisma: PrismaService) {}

  public findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }
  public findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  public async createUser(payload: UserLogin): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: { ...payload },
      });
    } catch (error: unknown) {
      if (isUniqueField(error, ['email'])) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
  }

  async bumpTokenVersion(userId: string): Promise<number> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return updated.tokenVersion;
  }
}
