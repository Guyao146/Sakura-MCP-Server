import type { Database } from '../database.js';
import type { Scope } from '../config.js';
import type { SpaceRole } from './types.js';

const roleLevel: Record<SpaceRole, number> = { viewer: 1, contributor: 2, editor: 3, admin: 4, owner: 5 };

export async function requireSpaceRole(database: Database, userId: string, spaceId: string, minimum: SpaceRole): Promise<SpaceRole> {
  const result = await database.query<{ role: SpaceRole }>(
    `SELECT sm.role FROM space_members sm JOIN spaces s ON s.id = sm.space_id
     WHERE sm.user_id = $1 AND sm.space_id = $2 AND s.deleted_at IS NULL`, [userId, spaceId]);
  const role = result.rows[0]?.role;
  if (!role || roleLevel[role] < roleLevel[minimum]) throw new Error(`Space access denied: ${minimum} role required.`);
  return role;
}

export async function requireAgentSpaceScope(database: Database, agentId: string | undefined, spaceId: string, scope: Scope): Promise<void> {
  if (!agentId) return;
  const result = await database.query<{ scopes: Scope[] }>(
    `SELECT asg.scopes FROM agent_space_grants asg JOIN agent_credentials ac ON ac.id=asg.agent_id
     WHERE asg.agent_id=$1 AND asg.space_id=$2 AND ac.revoked_at IS NULL
     AND (ac.expires_at IS NULL OR ac.expires_at>now())`, [agentId, spaceId]);
  if (!result.rows[0]?.scopes.includes(scope)) throw new Error(`Agent is not granted ${scope} in this space.`);
}
