# Changelog

All notable changes to Sakura-MCP-Server are documented here.

## [0.2.0] - 2026-08-26

### Added

- Multi-user personal and shared memory spaces with role-based access.
- Authentik OAuth/OIDC login using Authorization Code + PKCE.
- Database-backed Agent keys with scopes, expiry, revocation and per-space grants.
- PostgreSQL + pgvector memory storage, versioning, sources, relations and feedback.
- OpenAI-compatible and Ollama Chat/Embedding providers.
- Full-text and semantic hybrid recall with mixed-dimension safety.
- Automatic candidate extraction, duplicate detection and human conflict resolution.
- Portable JSON/Markdown import and export.
- MCP Tools and `memory://` Resources.
- Secure Web management console and first-run installation wizard.
- PostgreSQL background queue with concurrent claiming, recovery, retry and cancellation.
- Space-wide embedding rebuild jobs.
- Tenant-filtered PostgreSQL audit logs with JSONL fallback and recursive redaction.
- HTTP security headers, tiered rate limits and detailed health checks.
- Docker Compose deployment with pgvector and container hardening.
- CI with real PostgreSQL integration tests, npm audit, Docker build and Trivy scan.

### Changed

- Product focus changed from project-specific integrations to a universal AI long-term memory platform.
- MCP transport is stateless per request to prevent cross-principal session reuse.

### Security

- Provider secrets use AES-256-GCM encryption at rest.
- Agent and Web Session tokens are stored only as SHA-256 hashes.
- CSRF protection is bound to each Web Session.
- Audit metadata redacts credentials and memory bodies.
- Cross-space and cross-user access is enforced in repository and SQL query layers.

## [0.1.0] - 2026-08-25

- Initial secure Streamable HTTP MCP server skeleton.
- API Key and Authentik JWT resource-server authentication.
- Docker, Nginx, CI and automatic GitHub Release workflow.
