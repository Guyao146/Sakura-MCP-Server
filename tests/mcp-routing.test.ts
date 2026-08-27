import { describe, expect, it } from 'vitest';
import { isRootMcpRequest } from '../src/mcp-routing.js';

describe('root MCP and browser routing', () => {
  it('keeps ordinary browser navigation on the Web entry point', () => {
    expect(isRootMcpRequest('GET', new Headers({ Accept: 'text/html,application/xhtml+xml' }))).toBe(false);
    expect(isRootMcpRequest('GET', new Headers({ Accept: '*/*' }))).toBe(false);
    expect(isRootMcpRequest('HEAD', new Headers())).toBe(false);
  });

  it('routes MCP request methods and headers to the root MCP endpoint', () => {
    expect(isRootMcpRequest('POST', new Headers({ 'Content-Type': 'application/json' }))).toBe(true);
    expect(isRootMcpRequest('DELETE', new Headers())).toBe(true);
    expect(isRootMcpRequest('GET', new Headers({ Accept: 'text/event-stream' }))).toBe(true);
    expect(isRootMcpRequest('GET', new Headers({ Authorization: 'Bearer test' }))).toBe(true);
    expect(isRootMcpRequest('GET', new Headers({ 'MCP-Protocol-Version': '2025-06-18' }))).toBe(true);
    expect(isRootMcpRequest('GET', new Headers({ 'Mcp-Session-Id': 'session' }))).toBe(true);
  });

  it('prefers browser navigation when HTML and event streams are both accepted', () => {
    expect(isRootMcpRequest('GET', new Headers({ Accept: 'text/html,text/event-stream' }))).toBe(false);
    expect(isRootMcpRequest('GET', new Headers({ Accept: 'text/html', Authorization: 'Bearer proxy-session' }))).toBe(false);
  });
});