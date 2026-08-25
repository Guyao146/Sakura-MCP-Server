import { createHash, randomBytes } from 'node:crypto';
import type { Scope } from '../config.js';
import type { Database } from '../database.js';
import { requireSpaceRole } from '../memory/permissions.js';

export class AgentRepository {
  constructor(private readonly database: Database) {}

  async create(ownerId: string, name: string, scopes: Scope[], expiresAt?: string) {
    const prefix = randomBytes(6).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const token = `sk_sakura_${prefix}_${secret}`;
    const secretHash = createHash('sha256').update(token).digest('hex');
    const result = await this.database.query<{ id: string; name: string; key_prefix: string; scopes: Scope[]; expires_at: string | null; created_at: string }>(
      `INSERT INTO agent_credentials(owner_id,name,key_prefix,secret_hash,scopes,expires_at)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,key_prefix,scopes,expires_at,created_at`,
      [ownerId, name, prefix, secretHash, scopes, expiresAt ?? null]);
    return { ...result.rows[0], token };
  }

  async list(ownerId: string) {
    const result = await this.database.query(
      `SELECT ac.id,ac.name,ac.key_prefix,ac.scopes,ac.expires_at,ac.revoked_at,ac.last_used_at,ac.created_at,
       coalesce(json_agg(json_build_object('space_id',asg.space_id,'scopes',asg.scopes)) FILTER (WHERE asg.space_id IS NOT NULL),'[]') AS space_grants
       FROM agent_credentials ac LEFT JOIN agent_space_grants asg ON asg.agent_id=ac.id
       WHERE ac.owner_id=$1 GROUP BY ac.id ORDER BY ac.created_at DESC`, [ownerId]);
    return result.rows;
  }

  async revoke(ownerId: string, agentId: string): Promise<void> {
    const result = await this.database.query('UPDATE agent_credentials SET revoked_at=now() WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL', [agentId, ownerId]);
    if (!result.rowCount) throw new Error('Agent credential not found or already revoked.');
  }

  async grant(ownerId: string, agentId: string, spaceId: string, scopes: Scope[]) {
    await requireSpaceRole(this.database, ownerId, spaceId, 'viewer');
    const agent = await this.database.query<{ scopes: Scope[] }>('SELECT scopes FROM agent_credentials WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL', [agentId, ownerId]);
    if (!agent.rowCount) throw new Error('Agent credential not found or revoked.');
    const invalid = scopes.filter(scope => !agent.rows[0].scopes.includes(scope));
    if (invalid.length) throw new Error(`Space grant exceeds Agent global scopes: ${invalid.join(', ')}.`);
    await this.database.query(
      `INSERT INTO agent_space_grants(agent_id,space_id,scopes) VALUES($1,$2,$3)
       ON CONFLICT(agent_id,space_id) DO UPDATE SET scopes=EXCLUDED.scopes`, [agentId, spaceId, scopes]);
    return { agentId, spaceId, scopes };
  }

  async revokeGrant(ownerId: string, agentId: string, spaceId: string): Promise<void> {
    const result = await this.database.query(
      `DELETE FROM agent_space_grants asg USING agent_credentials ac
       WHERE asg.agent_id=ac.id AND asg.agent_id=$1 AND asg.space_id=$2 AND ac.owner_id=$3`, [agentId, spaceId, ownerId]);
    if (!result.rowCount) throw new Error('Agent space grant not found.');
  }
}