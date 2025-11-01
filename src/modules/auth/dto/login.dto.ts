import { IsEmail, IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../consts/validator.consts';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password: string;
}
