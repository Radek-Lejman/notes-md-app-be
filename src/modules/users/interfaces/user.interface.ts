export interface User {
  id: string;
  email: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
  tokenVersion: number;
}


export type UserLogin = Pick<User, 'email' | 'password'>