import type { AppConfig } from '../config.js';

export class HomeAssistantAdapter {
  constructor(private readonly config: NonNullable<AppConfig['homeAssistant']>) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.url}${path}`, { ...init, headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Home Assistant request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }
  async states(): Promise<Array<{ entity_id: string; state: string; attributes: Record<string, unknown>; last_changed: string }>> { return this.request('/api/states'); }
  async state(entityId: string) { return this.request(`/api/states/${encodeURIComponent(entityId)}`); }
  async control(entityId: string, service: 'turn_on' | 'turn_off' | 'toggle') {
    if (!this.config.controllableEntities.has(entityId)) throw new Error('Entity is not in HOME_ASSISTANT_CONTROLLABLE_ENTITIES.');
    const domain = entityId.split('.')[0];
    return this.request(`/api/services/${domain}/${service}`, { method: 'POST', body: JSON.stringify({ entity_id: entityId }) });
  }
  async activateScene(entityId: string) {
    if (!this.config.allowedScenes.has(entityId)) throw new Error('Scene is not in HOME_ASSISTANT_ALLOWED_SCENES.');
    return this.request('/api/services/scene/turn_on', { method: 'POST', body: JSON.stringify({ entity_id: entityId }) });
  }
}
