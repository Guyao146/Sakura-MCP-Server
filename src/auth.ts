import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import type { AppConfig, Scope } from './config.js';

export interface Principal {
  id: string;
  source: 'api_key' | 'authentik';
  scopes: Scope[];
  expiresAt: number;
  email?: string;
  displayName?: string;
}

const equal = (left: string, right: string): boolean => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class AuthService {
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly config: AppConfig) {
    if (config.authentik) this.jwks = createRemoteJWKSet(new URL(config.authentik.jwksUri));
  }

  async authenticate(header: string | undefined): Promise<Principal> {
    if (!header?.startsWith('Bearer ')) throw new Error('Missing Bearer credential.');
    const credential = header.slice(7).trim();
    const apiKey = this.config.apiKeys.find(key => equal(key.secret, credential));
    if (apiKey) return { id: apiKey.id, source: 'api_key', scopes: apiKey.scopes, expiresAt: Math.floor(Date.now() / 1000) + 300 };
    if (!this.config.authentik || !this.jwks) throw new Error('Invalid credential.');
    const { payload } = await jwtVerify(credential, this.jwks, { issuer: this.config.authentik.issuer, audience: this.config.authentik.audience });
    const subject = payload.sub;
    if (!subject || !payload.exp) throw new Error('Authentik token is missing sub or exp.');
    const rawScopes = payload[this.config.authentik.scopeClaim];
    const scopes = Array.isArray(rawScopes) ? rawScopes : typeof rawScopes === 'string' ? rawScopes.split(' ') : [];
    return {
      id: subject,
      source: 'authentik',
      scopes: scopes as Scope[],
      expiresAt: payload.exp,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      displayName: typeof payload.name === 'string' ? payload.name : typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined
    };
  }
}

export function requireScopes(principal: Principal, scopes: Scope[]): void {
  const missing = scopes.filter(scope => !principal.scopes.includes(scope));
  if (missing.length) throw new Error(`Missing required scope: ${missing.join(', ')}.`);
}
