# Changelog

All notable changes to Sakura-MCP-Server are documented here.

## [0.2.22] - 2026-08-27

### Added

- Add a dedicated Embedding provider so vector generation can point at a different OpenAI-compatible endpoint (separate base URL, API key, and model) from the Chat provider, configurable in the setup wizard and the admin console. New `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, and `EMBEDDING_MODEL` environment defaults are also supported.
- Surface upstream OpenAI-compatible error bodies in embedding and memory-extraction failures instead of only the HTTP status code, making 4xx causes such as unsupported embedding models easier to diagnose.

## [0.2.21] - 2026-08-27

### Fixed

- Align setup-page localization assertions with the current Issuer and Audience labels so CI and automated Release packaging complete successfully.

## [0.2.20] - 2026-08-27

### Added

- Validate Authentik Public Client behavior during setup using a safe invalid-code PKCE Token Endpoint preflight; only `invalid_grant` is accepted.
- Add system-administrator Authentik recovery APIs and a management page for testing and atomically saving identity configuration.
- Support a documented, access-restricted `AUTH=false` recovery workflow for installations locked out by broken Authentik settings.

### Fixed

- Prevent installation from completing when Authentik returns `invalid_client`, including Confidential Client, wrong Client ID, or unsupported authentication-method configurations.

## [0.2.19] - 2026-08-27

### Fixed

- Surface bounded and sanitized Authentik OAuth token endpoint `error` and `error_description` values on callback failures.
- Add actionable Public Client guidance for `invalid_client` and redirect URI/new-login guidance for `invalid_grant` without exposing request IDs or token response secrets.

## [0.2.18] - 2026-08-27

### Added

- Accept MCP Streamable HTTP requests directly on the public root URL while retaining `/mcp` as a compatible endpoint.
- Route ordinary browser root requests to setup/admin and detect MCP requests by method, SSE Accept header, authorization, protocol version, or session headers.
- Publish RFC 9728 protected-resource metadata for both the root and legacy MCP resource URLs.

## [0.2.17] - 2026-08-27

### Changed

- Localize Authentik wizard labels and placeholders into Chinese while retaining standard OAuth/OIDC terms in parentheses where useful for troubleshooting.

## [0.2.16] - 2026-08-27

### Added

- Add Authentik OpenID Connect discovery to the first-run wizard using an HTTPS Authentik origin and application slug.
- Automatically fetch `/application/o/<slug>/.well-known/openid-configuration` after a short input debounce and provide a manual retry button.
- Fill Issuer, JWKS, authorization, token and UserInfo endpoints from validated discovery metadata while leaving Audience and Client ID explicit.

### Security

- Fetch discovery metadata server-side without redirects, enforce a bounded JSON response, and reject insecure or cross-origin returned endpoints.

## [0.2.15] - 2026-08-27

### Added

- Add `AUTH=false` and lowercase `auth=false` support for explicitly access-restricted single-user deployments.
- Skip the Authentik step in the first-run wizard when authentication is disabled.
- Provide a stable local system administrator, personal memory space and full-scope MCP principal in no-auth mode.
- Show the active authentication mode in health responses and the management dashboard.

### Security

- Keep authentication enabled by default. The dashboard displays a permanent warning when no-auth mode is active because every network visitor receives full administrator access.
- Preserve CSRF validation for management write requests even when external identity authentication is disabled.

## [0.2.14] - 2026-08-27

### Fixed

- Do not send `Content-Type: application/json` on GET or bodyless management requests. The MCP/Hono request parser otherwise rejected them with `HTTP 400 Invalid JSON` before the route handler ran.
- Surface bounded plain-text upstream errors in the setup wizard and management dashboard instead of replacing them with a generic non-JSON message.

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
