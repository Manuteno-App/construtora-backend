export interface JwtPayload {
  sub: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}
