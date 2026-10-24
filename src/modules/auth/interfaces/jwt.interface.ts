interface TokenPayloadBase {
  sub: string;
  email: string;
  /** User.tokenVersion at issue time; "log out everywhere" bumps it and voids older tokens. */
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export interface AccessTokenPayload extends TokenPayloadBase {
  /**
   * Session id: the jti of the refresh token issued together with this access token, so logout
   * can revoke that refresh token. Absent in tokens issued before it was introduced.
   */
  sid?: string;
}

export type RefreshTokenPayload = TokenPayloadBase & {
  jti: string;
};

/** A signed refresh token and its id (the RefreshToken row and the access token's `sid`). */
export interface IssuedRefreshToken {
  token: string;
  jti: string;
}

export type DaysJwtConfigString = `${number}d`;
export type MinutesJwtConfigString = `${number}m`;
