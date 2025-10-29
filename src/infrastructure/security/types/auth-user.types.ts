export interface AuthUser {
  sub: string;
  email?: string;
  iat?: number;
  exp?: number;
}
