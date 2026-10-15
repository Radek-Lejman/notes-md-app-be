export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** User.tokenVersion at issue time; "log out everywhere" bumps it and voids older tokens. */
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export type RefreshTokenPayload = AccessTokenPayload & {
  jti: string;
};

export type DaysJwtConfigString = `${number}d`;
export type MinutesJwtConfigString = `${number}m`;
