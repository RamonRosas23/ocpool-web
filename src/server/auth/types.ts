export type Actor = {
  userId: string;
  type: 'CUSTOMER' | 'EMPLOYEE';
  clientId: string | null;
  permissionKeys: ReadonlySet<string>;
  mfaVerified: boolean;
};

export type SessionCookieOptions = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  expires: Date;
  maxAge: number;
};
