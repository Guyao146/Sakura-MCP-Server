import { describe, expect, it, vi } from 'vitest';
import { Database } from '../src/database.js';

describe('database startup retry', () => {
  it('retries transient migration failures and eventually succeeds', async () => {
    const database = new Database('postgresql://unused', 1);
    const migrate = vi.spyOn(database, 'migrate').mockRejectedValueOnce(new Error('getaddrinfo EAI_AGAIN postgres'))
      .mockResolvedValueOnce(undefined);
    await expect(database.migrateWithRetry('.', 2, 1)).resolves.toBeUndefined();
    expect(migrate).toHaveBeenCalledTimes(2);
    await database.close();
  });
});