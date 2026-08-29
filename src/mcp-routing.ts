export function isRootMcpRequest(method: string, headers: Headers): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') return true;
  const accept = headers.get('accept')?.toLowerCase() ?? '';
  if (accept.includes('text/html')) return false;
  if (headers.has('authorization') || headers.has('mcp-protocol-version') || headers.has('mcp-session-id')) return true;
  return accept.includes('text/event-stream');
}
/**
 * Wraps a streaming Response so that `cleanup` runs only after the body has
 * fully flushed, errored, or been cancelled by the client — never before the
 * first byte is written. The MCP SSE transport resolves its Response as soon as
 * the object exists while the body keeps streaming, so closing the transport
 * eagerly (in a `finally`) tore the stream down and clients saw an empty stream
 * that timed out. Non-streaming responses run cleanup immediately.
 */
export function streamWithDeferredCleanup(response: Response, cleanup: () => Promise<void>): Response {
  let done = false;
  const runOnce = async () => { if (done) return; done = true; await cleanup(); };
  if (!response.body) { void runOnce(); return response; }
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) { controller.close(); await runOnce(); return; }
        controller.enqueue(value);
      } catch (error) { controller.error(error); await runOnce(); }
    },
    async cancel(reason) { await reader.cancel(reason).catch(() => undefined); await runOnce(); }
  });
  return new Response(stream, { status: response.status, headers: response.headers });
}
