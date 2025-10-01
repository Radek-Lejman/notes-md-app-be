export interface AccessTokenPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export type RefreshTokenPayload = AccessTokenPayload & {
  tokenVersion: number;
  jti: string;
};
