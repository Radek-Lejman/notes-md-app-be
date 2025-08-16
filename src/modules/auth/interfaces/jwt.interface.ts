export interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}
export type RefreshPayload = JwtPayload & {
  tokenVersion: number;
};
