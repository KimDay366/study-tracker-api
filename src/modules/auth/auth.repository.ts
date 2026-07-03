import { query, getClient } from "../../lib/db.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  nickname: string;
  password_hash: string | null;
  email_verified: boolean;
  status: "active" | "suspended" | "deleted";
  role: "user" | "admin" | "super_admin";
}

export const findUserByEmail = async (email: string): Promise<UserRow | null> => {
  const res = await query<UserRow>(
    "SELECT id, email, name, nickname, password_hash, email_verified, status, role FROM users WHERE email = $1",
    [email],
  );
  return res.rows[0] ?? null;
};

export const findUserById = async (id: string): Promise<UserRow | null> => {
  const res = await query<UserRow>(
    "SELECT id, email, name, nickname, password_hash, email_verified, status, role FROM users WHERE id = $1",
    [id],
  );
  return res.rows[0] ?? null;
};

/** users + user_identities(email) 동시 삽입 — 트랜잭션 */
export const insertUser = async (params: {
  email: string;
  name: string;
  nickname: string;
  passwordHash: string;
}): Promise<UserRow> => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const userRes = await client.query<UserRow>(
      `INSERT INTO users (email, name, nickname, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, nickname, password_hash, email_verified, status, role`,
      [params.email, params.name, params.nickname, params.passwordHash],
    );
    const user = userRes.rows[0];

    await client.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ($1, 'email', NULL)`,
      [user.id],
    );

    await client.query("COMMIT");
    return user;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

export const setEmailVerified = async (userId: string): Promise<void> => {
  await query("UPDATE users SET email_verified = true WHERE id = $1", [userId]);
};

// ─── User Identities (소셜 로그인) ───────────────────────────────────────────

export const findUserIdentityByProvider = async (
  provider: string,
  providerUserId: string,
): Promise<{ user_id: string } | null> => {
  const res = await query<{ user_id: string }>(
    "SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2",
    [provider, providerUserId],
  );
  return res.rows[0] ?? null;
};

export const insertUserIdentity = async (
  userId: string,
  provider: string,
  providerUserId: string,
): Promise<void> => {
  await query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id)
     VALUES ($1, $2, $3)`,
    [userId, provider, providerUserId],
  );
};

/** OAuth 유저 생성 — users(password_hash NULL, email_verified true) + user_identities 트랜잭션 */
export const insertOAuthUser = async (params: {
  email: string;
  name: string;
  nickname: string;
  provider: string;
  providerUserId: string;
}): Promise<UserRow> => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const userRes = await client.query<UserRow>(
      `INSERT INTO users (email, name, nickname, password_hash, email_verified)
       VALUES ($1, $2, $3, NULL, true)
       RETURNING id, email, name, nickname, password_hash, email_verified, status, role`,
      [params.email, params.name, params.nickname],
    );
    const user = userRes.rows[0];

    await client.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ($1, $2, $3)`,
      [user.id, params.provider, params.providerUserId],
    );

    await client.query("COMMIT");
    return user;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── Refresh Tokens ───────────────────────────────────────────────────────────

export const insertRefreshToken = async (params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> => {
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [params.userId, params.tokenHash, params.expiresAt],
  );
};

export interface RefreshTokenRow {
  id: number;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export const findValidRefreshTokenByHash = async (
  tokenHash: string,
): Promise<RefreshTokenRow | null> => {
  const res = await query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );
  return res.rows[0] ?? null;
};

export const revokeRefreshToken = async (tokenHash: string): Promise<void> => {
  await query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1",
    [tokenHash],
  );
};

export const revokeAllUserRefreshTokens = async (userId: string): Promise<void> => {
  await query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
};

// ─── Email Verification Tokens ────────────────────────────────────────────────

export const insertEmailVerifyToken = async (params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> => {
  await query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [params.userId, params.tokenHash, params.expiresAt],
  );
};

export interface EmailVerifyTokenRow {
  id: number;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
}

export const findEmailVerifyTokenByHash = async (
  tokenHash: string,
): Promise<EmailVerifyTokenRow | null> => {
  const res = await query<EmailVerifyTokenRow>(
    `SELECT id, user_id, token_hash, expires_at, consumed_at
     FROM email_verification_tokens
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );
  return res.rows[0] ?? null;
};

export const consumeEmailVerifyToken = async (id: number): Promise<void> => {
  await query(
    "UPDATE email_verification_tokens SET consumed_at = NOW() WHERE id = $1",
    [id],
  );
};

export const deleteEmailVerifyTokensByUserId = async (userId: string): Promise<void> => {
  await query("DELETE FROM email_verification_tokens WHERE user_id = $1", [userId]);
};
