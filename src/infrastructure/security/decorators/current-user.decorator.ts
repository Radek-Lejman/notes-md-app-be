import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '@security/types/auth-user.types';

export const CurrentUser = createParamDecorator<AuthUser>(
  (data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
