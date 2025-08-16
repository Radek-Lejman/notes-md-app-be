import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma.service';
import { UserLogin, User } from './interfaces/user.interface';
import { isUniqueField } from 'src/common/prisma/prisma-errror';

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
}
