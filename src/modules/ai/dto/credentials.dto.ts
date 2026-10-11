import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CREDENTIAL_TYPES, CredentialType } from '../credentials/credential.types';

export class SaveCredentialDto {
  @IsIn(CREDENTIAL_TYPES)
  type: CredentialType;

  @IsString()
  @MinLength(20)
  @MaxLength(512)
  secret: string;
}
