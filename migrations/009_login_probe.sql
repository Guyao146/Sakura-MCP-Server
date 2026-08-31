-- Distinguishes a silent `prompt=none` probe from a real login attempt.
--
-- The probe exists so that `/auth/login` can render "continue as <name>" when an
-- Authentik SSO session already exists. A probe necessarily obtains a valid
-- authorization code, so the purpose is persisted alongside the PKCE verifier
-- and checked when the code is redeemed. That makes it structurally impossible
-- for a probe to be upgraded into a web session, preserving the 0.2.25
-- behaviour where signing out never silently signs the user back in.
ALTER TABLE oidc_login_attempts
  ADD COLUMN purpose text NOT NULL DEFAULT 'login'
    CHECK (purpose IN ('login', 'probe'));
