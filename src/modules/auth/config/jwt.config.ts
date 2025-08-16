import { registerAs } from '@nestjs/config';
import { jwtAccessTokenConstant } from '../constants';

export default registerAs('jwt', () => ({
  secret: jwtAccessTokenConstant.secret,
  expiresIn: jwtAccessTokenConstant.expire_in,
}));
