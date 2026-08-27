export function isRootMcpRequest(method: string, headers: Headers): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') return true;
  const accept = headers.get('accept')?.toLowerCase() ?? '';
  if (accept.includes('text/html')) return false;
  if (headers.has('authorization') || headers.has('mcp-protocol-version') || headers.has('mcp-session-id')) return true;
  return accept.includes('text/event-stream');
}