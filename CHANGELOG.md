# Changelog

All notable changes to Sakura-MCP-Server are documented here.

## [0.2.13] - 2026-08-27

### Changed

- Remove the first-run setup token requirement. Uninstalled instances enter the wizard directly and automatically run environment diagnostics; completed installations remain permanently locked.
- Stop generating, exporting and proxying `SETUP_TOKEN` while keeping existing runtime secret volumes fully compatible.

### Added

- Display the running version in the management dashboard and let system administrators check the latest GitHub Release.
- Cache release checks for 15 minutes, support manual refresh, and expose one shared version constant to HTTP health, installation state and MCP server metadata.

### Fixed

- Replace stale hard-coded `0.2.2` values in health responses, installation records and MCP protocol metadata.

## [0.2.12] - 2026-08-26

### Fixed

- Preserve the public `Host`, forwarded protocol and client address for every Nginx upstream route so application host validation does not reject setup requests.
- Serve the setup wizard JavaScript as a same-origin external resource and bind actions with event listeners, keeping the wizard functional when 宝塔/Nginx applies a strict Content Security Policy.
- Accept either a raw setup token or a pasted `SETUP_TOKEN=...` line and show explicit loading, timeout, network and HTTP status feedback.

## [0.2.11] - 2026-08-26

### Fixed

- Make the Compose regression test validate the versioned GHCR image pattern instead of a stale hard-coded patch tag.

## [0.2.10] - 2026-08-26

### Fixed

- Add visible loading and 15-second timeout feedback to the installation environment check.
- Explicitly forward `X-Setup-Token` through the Nginx setup API proxy.

## [0.2.9] - 2026-08-26

### Fixed

- Use host port 3001 by default so the service does not conflict with LibreChat on host port 3000.
- Keep the internal application port at 3000 and make the host port configurable with `MCP_HOST_PORT`.

## [0.2.8] - 2026-08-26

### Fixed

- Use a stable PostgreSQL container hostname from the application entrypoint in Portainer/宝塔 Compose deployments.
- Keep PostgreSQL DNS retry behavior while avoiding reliance on the transient Compose service alias alone.

## [0.2.7] - 2026-08-26

### Fixed

- Align the Compose regression test and production image tag after the no-`.env` bootstrap and PostgreSQL retry fixes.

## [0.2.6] - 2026-08-26

### Fixed

- Publish the no-`.env` Compose bootstrap and PostgreSQL startup-retry fixes with the final aligned Compose regression test.

## [0.2.5] - 2026-08-26

### Fixed

- Align the Compose version regression test with the `0.2.4` startup-retry image change and publish a clean release tag.
- Make `0.2.5` the recommended no-`.env` Compose image.

## [0.2.4] - 2026-08-26

### Fixed

- Retry PostgreSQL DNS/connection failures during application startup instead of entering a restart loop when Compose starts services concurrently.
- Add an explicit Compose network and `postgres` service alias for panel-managed deployments.

## [0.2.3] - 2026-08-26

### Fixed

- Escaped shell variables in the no-`.env` Compose bootstrap script so Docker Compose does not warn about an unset `value` variable.
- Bootstrap-generated secrets are preserved across repeated starts and safely loaded by the non-root application container.

## [0.2.2] - 2026-08-26

### Changed

- Production Compose can start without a pre-created `.env` file.
- A one-shot `bootstrap-secrets` container generates and persists runtime secrets in a private Docker volume.
- PostgreSQL uses `POSTGRES_PASSWORD_FILE`; the application reads generated secrets through a read-only secret volume.
- The default GHCR image is now `ghcr.io/guyao146/sakura-mcp-server:0.2.2`.
- Windows PowerShell and Linux first-run installers remain available for domain-specific setup.

## [0.2.1] - 2026-08-26

### Added

- Public GHCR multi-platform container publishing workflow for `linux/amd64` and `linux/arm64`.
- Production Compose deployment from a versioned remote image.
- Separate `docker-compose.dev.yml` for local source builds.
- Linux installer support for remote-image mode and explicit `--local-build` mode.

### Changed

- The production image uses the `0.2.1` GHCR tag by default.
- The production runtime uses the Debian slim Node image and a non-root Debian user.

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
