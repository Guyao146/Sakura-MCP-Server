/**
 * Best-effort scrubbing of secrets before conversation text leaves the machine.
 * This is defence-in-depth, not a guarantee: it targets the high-frequency
 * shapes (API keys, bearer tokens, private keys, .env assignments) so an
 * accidental paste of a credential is not shipped to the memory store. Callers
 * can disable it, but it is on by default.
 */

interface RedactionRule { pattern: RegExp; replace: string; }

const RULES: RedactionRule[] = [
  // Sakura Agent keys and generic sk-/ghp-/gho- style tokens.
  { pattern: /sk_sakura_[A-Za-z0-9_-]{8,}/g, replace: '[REDACTED_SAKURA_KEY]' },
  { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, replace: '[REDACTED_API_KEY]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: '[REDACTED_SLACK_TOKEN]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: '[REDACTED_AWS_KEY]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: '[REDACTED_JWT]' },
  // Authorization: Bearer <token> / Basic <token>
  { pattern: /(Authorization"?\s*[:=]\s*"?\s*)(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: '$1$2 [REDACTED]' },
  { pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/g, replace: '$1 [REDACTED]' },
  // PEM private key blocks.
  { pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, replace: '[REDACTED_PRIVATE_KEY]' },
  // KEY=VALUE / "password": "value" style secrets. Keeps the key, masks the value.
  { pattern: /((?:api[_-]?key|secret|password|passwd|pwd|token|access[_-]?key|private[_-]?key|client[_-]?secret)"?\s*[:=]\s*"?)([^\s"',}]{6,})/gi, replace: '$1[REDACTED]' }
];

export function redactSecrets(text: string): string {
  return RULES.reduce((acc, rule) => acc.replace(rule.pattern, rule.replace), text);
}
