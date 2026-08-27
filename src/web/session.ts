import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppConfig } from '../config.js';
import type { Database } from '../database.js';
import { MemoryRepository } from '../memory/repository.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const base64url = (value: Buffer) => value.toString('base64url');

export interface WebIdentity {
  sessionId: string; userId: string; subject: string; email: string | null; displayName: string;
  avatarUrl: string | null; isSystemAdmin: boolean; expiresAt: string;
}

export class WebSessionService {
  private localIdentityPromise?: Promise<WebIdentity>;
  constructor(private readonly database: Database, private readonly getConfig: () => AppConfig) {}

  async localIdentity(): Promise<WebIdentity> {
    if (this.getConfig().authEnabled) throw new Error('Local identity is only available when AUTH=false.');
    if (!this.localIdentityPromise) this.localIdentityPromise = this.createLocalIdentity().catch(error => {
      this.localIdentityPromise = undefined;
      throw error;
    });
    return this.localIdentityPromise;
  }

  async begin(returnTo = '/admin') {
    const auth = this.requireConfig();
    const safeReturnTo = /^\/(?!\/)/.test(returnTo) ? returnTo : '/admin';
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const nonce = base64url(randomBytes(24));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    await this.database.query(
      `INSERT INTO oidc_login_attempts(state_hash,code_verifier,nonce,return_to,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes')`, [hash(state), verifier, nonce, safeReturnTo]);
    await this.database.query('DELETE FROM oidc_login_attempts WHERE expires_at<=now()');
    const url = new URL(auth.authorizationUrl!);
    url.searchParams.set('client_id', auth.clientId!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', `${this.getConfig().publicBaseUrl}/auth/callback`);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async callback(code: string, state: string): Promise<{ token: string; returnTo: string }> {
    const auth = this.requireConfig();
    const client = await this.database.pool.connect();
    let attempt: { code_verifier: string; nonce: string; return_to: string } | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query<{ code_verifier: string; nonce: string; return_to: string }>(
        `DELETE FROM oidc_login_attempts WHERE state_hash=$1 AND expires_at>now()
         RETURNING code_verifier,nonce,return_to`, [hash(state)]);
      attempt = result.rows[0];
      if (!attempt) throw new Error('OIDC login state is invalid or expired.');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }

    const tokenResponse = await fetch(auth.tokenUrl!, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: auth.clientId!, code,
        redirect_uri: `${this.getConfig().publicBaseUrl}/auth/callback`, code_verifier: attempt.code_verifier }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!tokenResponse.ok) throw new Error(await describeTokenExchangeFailure(tokenResponse));
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error('Authentik token response did not include id_token.');
    const jwks = createRemoteJWKSet(new URL(auth.jwksUri));
    const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: auth.issuer, audience: auth.clientId, maxTokenAge: '10m' });
    if (payload.nonce !== attempt.nonce) throw new Error('OIDC nonce validation failed.');
    if (!payload.sub) throw new Error('OIDC ID Token is missing subject.');
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const displayName = typeof payload.name === 'string' ? payload.name : typeof payload.preferred_username === 'string' ? payload.preferred_username : payload.sub;
    const identity = await new MemoryRepository(this.database).ensureUser(payload.sub, { email, displayName });
    const token = `sess_${base64url(randomBytes(32))}`;
    await this.database.query(
      `INSERT INTO web_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '12 hours')`,
      [identity.userId, hash(token)]);
    return { token, returnTo: attempt.return_to };
  }

  async authenticate(token: string | undefined): Promise<WebIdentity> {
    if (!token?.startsWith('sess_')) throw new Error('Web session is missing.');
    const result = await this.database.query<{
      session_id: string; user_id: string; oidc_subject: string; email: string | null; display_name: string;
      avatar_url: string | null; is_system_admin: boolean; expires_at: string;
    }>(
      `SELECT ws.id AS session_id,u.id AS user_id,u.oidc_subject,u.email,u.display_name,u.avatar_url,u.is_system_admin,ws.expires_at
       FROM web_sessions ws JOIN users u ON u.id=ws.user_id
       WHERE ws.token_hash=$1 AND ws.revoked_at IS NULL AND ws.expires_at>now()`, [hash(token)]);
    const row = result.rows[0];
    if (!row) throw new Error('Web session is invalid, expired, or revoked.');
    await this.database.query('UPDATE web_sessions SET last_seen_at=now() WHERE id=$1', [row.session_id]);
    return { sessionId: row.session_id, userId: row.user_id, subject: row.oidc_subject, email: row.email,
      displayName: row.display_name, avatarUrl: row.avatar_url, isSystemAdmin: row.is_system_admin, expiresAt: row.expires_at };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.database.query('UPDATE web_sessions SET revoked_at=now() WHERE token_hash=$1', [hash(token)]);
  }

  csrf(identity: WebIdentity): string {
    return createHmac('sha256', this.getConfig().setup.encryptionKey)
      .update(`csrf:${identity.sessionId}:${identity.userId}`).digest('base64url');
  }

  verifyCsrf(identity: WebIdentity, candidate: string | undefined): boolean {
    if (!candidate) return false;
    const expected = Buffer.from(this.csrf(identity));
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  cookie(token: string, maxAge = 43_200): string {
    const secure = this.getConfig().publicBaseUrl.startsWith('https://') ? '; Secure' : '';
    return `sakura_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  clearCookie(): string { return `sakura_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.getConfig().publicBaseUrl.startsWith('https://') ? '; Secure' : ''}`; }

  static readCookie(header: string | undefined): string | undefined {
    return header?.split(';').map(item => item.trim()).find(item => item.startsWith('sakura_session='))?.slice('sakura_session='.length);
  }

  private async createLocalIdentity(): Promise<WebIdentity> {
    const identity = await new MemoryRepository(this.database).ensureUser('local-admin', { displayName: 'Local Administrator' });
    await this.database.query('UPDATE users SET is_system_admin=true WHERE id=$1', [identity.userId]);
    return {
      sessionId: '00000000-0000-4000-8000-000000000001', userId: identity.userId, subject: 'local-admin',
      email: null, displayName: 'Local Administrator', avatarUrl: null, isSystemAdmin: true,
      expiresAt: '9999-12-31T23:59:59.999Z'
    };
  }

  private requireConfig(): Required<NonNullable<AppConfig['authentik']>> {
    const auth = this.getConfig().authentik;
    if (!auth?.clientId || !auth.authorizationUrl || !auth.tokenUrl) throw new Error('Authentik browser login is not configured.');
    return auth as Required<NonNullable<AppConfig['authentik']>>;
  }
}

export async function describeTokenExchangeFailure(response: Response): Promise<string> {
  const prefix = `Authentik 令牌交换失败（HTTP ${response.status}）`;
  let raw = '';
  try { raw = await readBoundedResponse(response, 64 * 1024); }
  catch { return `${prefix}。`; }
  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch { return `${prefix}${raw ? `：${safeErrorText(raw)}` : '。'}`; }
  const object = decoded && typeof decoded === 'object' ? decoded as Record<string, unknown> : {};
  const code = typeof object.error === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(object.error) ? object.error : '';
  const description = typeof object.error_description === 'string' ? safeErrorText(object.error_description) : '';
  const detail = [code, description].filter(Boolean).join('：');
  const guidance = code === 'invalid_client'
    ? '请确认 Authentik OAuth2/OIDC 提供方的客户端类型为 Public（公共客户端），并且 Client ID 与安装配置一致。'
    : code === 'invalid_grant'
      ? '请确认回调地址精确为当前域名的 /auth/callback，并重新发起登录以获取新的授权码。'
      : '';
  return `${prefix}${detail ? `：${detail}` : ''}。${guidance}`;
}

async function readBoundedResponse(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Response is too large.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Response is too large.');
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}

function safeErrorText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}