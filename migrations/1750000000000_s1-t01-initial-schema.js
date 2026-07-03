/**
 * S1-T01: 전체 스키마 초기 마이그레이션
 *
 * 생성 테이블:
 * [인증/계정] users, user_identities, refresh_tokens, email_verification_tokens, password_reset_tokens
 * [도메인]    study_logics, categories, daily_records, logic_snapshots, snapshot_categories,
 *             sessions, weekly_reviews, routine_settings, routine_days, app_settings
 * [어드민]    notices, quotes, account_suspensions, admin_audit_log
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function up(pgm) {
  // ============================================================
  // updated_at 자동 갱신 트리거 함수 (공통)
  // ============================================================
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // ============================================================
  // 인증/계정 테이블
  // ============================================================

  // users
  pgm.sql(`
    CREATE TABLE users (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email            TEXT NOT NULL UNIQUE,
      name             TEXT,
      nickname         TEXT,
      password_hash    TEXT,                                   -- OAuth 전용 계정은 NULL
      email_verified   BOOLEAN NOT NULL DEFAULT false,
      status           TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'suspended', 'deleted')),
      suspended_until  TIMESTAMPTZ,
      suspend_reason   TEXT,
      role             TEXT NOT NULL DEFAULT 'user'
                         CHECK (role IN ('user', 'admin', 'super_admin')),
      deleted_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- 성별·생년월일·휴대전화 컬럼 없음 (최소수집 원칙 M-03)
  `);

  pgm.sql(`
    CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.createIndex("users", "email");
  pgm.createIndex("users", "status");

  // user_identities (Account Linking)
  pgm.sql(`
    CREATE TABLE user_identities (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider         TEXT NOT NULL CHECK (provider IN ('email', 'google', 'kakao', 'naver')),
      provider_user_id TEXT,         -- email provider는 NULL 가능
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (provider, provider_user_id)
    );
  `);

  pgm.createIndex("user_identities", "user_id");

  // refresh_tokens
  pgm.sql(`
    CREATE TABLE refresh_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL,   -- 평문 저장 금지, bcrypt/sha256 해시
      expires_at  TIMESTAMPTZ NOT NULL,
      revoked_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("refresh_tokens", "user_id");

  // email_verification_tokens
  pgm.sql(`
    CREATE TABLE email_verification_tokens (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash   TEXT NOT NULL,
      expires_at   TIMESTAMPTZ NOT NULL,
      consumed_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("email_verification_tokens", "user_id");

  // password_reset_tokens (유효 기간 30분 — 앱 레벨에서 expires_at 설정)
  pgm.sql(`
    CREATE TABLE password_reset_tokens (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash   TEXT NOT NULL,
      expires_at   TIMESTAMPTZ NOT NULL,
      consumed_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("password_reset_tokens", "user_id");

  // ============================================================
  // 도메인 테이블
  // ============================================================

  // study_logics
  pgm.sql(`
    CREATE TABLE study_logics (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                  TEXT NOT NULL CHECK (char_length(name) <= 20),
      total_target_minutes  INT  NOT NULL CHECK (total_target_minutes BETWEEN 1 AND 1440),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("study_logics", "user_id", { name: "idx_study_logics_user_id" });

  pgm.sql(`
    CREATE TRIGGER trg_study_logics_updated_at
    BEFORE UPDATE ON study_logics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // categories
  pgm.sql(`
    CREATE TABLE categories (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      logic_id        UUID NOT NULL REFERENCES study_logics(id) ON DELETE CASCADE,
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      color_var       TEXT NOT NULL,
      target_minutes  INT  NOT NULL CHECK (target_minutes BETWEEN 1 AND 1440),
      target_percent  NUMERIC(5,1) NOT NULL CHECK (target_percent BETWEEN 0.1 AND 100.0),
      sort_order      SMALLINT NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("categories", "logic_id", { name: "idx_categories_logic_id" });

  // daily_records
  pgm.sql(`
    CREATE TABLE daily_records (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date        DATE NOT NULL,
      logic_id    UUID REFERENCES study_logics(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (user_id, date)
    );
  `);

  pgm.createIndex("daily_records", ["user_id", "date"], {
    name: "idx_daily_records_user_date",
    order: { date: "DESC" },
  });

  pgm.sql(`
    CREATE TRIGGER trg_daily_records_updated_at
    BEFORE UPDATE ON daily_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // logic_snapshots
  pgm.sql(`
    CREATE TABLE logic_snapshots (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      daily_record_id       UUID NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
      logic_name            TEXT NOT NULL,
      total_target_minutes  INT  NOT NULL
    );
  `);

  // snapshot_categories
  pgm.sql(`
    CREATE TABLE snapshot_categories (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id     UUID NOT NULL REFERENCES logic_snapshots(id) ON DELETE CASCADE,
      category_id     TEXT NOT NULL,   -- 원본 category UUID (TEXT 보관, 삭제된 카테고리 참조 가능)
      name            TEXT NOT NULL,
      color_var       TEXT NOT NULL,
      target_minutes  INT  NOT NULL,
      target_percent  NUMERIC(5,1) NOT NULL,
      sort_order      SMALLINT NOT NULL DEFAULT 0
    );
  `);

  pgm.createIndex("snapshot_categories", "snapshot_id", {
    name: "idx_snapshot_categories_snapshot_id",
  });

  // sessions
  pgm.sql(`
    CREATE TABLE sessions (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      daily_record_id      UUID NOT NULL REFERENCES daily_records(id) ON DELETE CASCADE,
      user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id          TEXT NOT NULL,   -- snapshot 내 category_id 대응 (FK 없음)
      session_start_ts     BIGINT NOT NULL, -- ms 정수
      session_end_ts       BIGINT NOT NULL, -- ms 정수
      duration_minutes     INT NOT NULL CHECK (duration_minutes >= 0),
      is_manually_edited   BOOLEAN NOT NULL DEFAULT false,
      edited_at            TIMESTAMPTZ,
      source               TEXT NOT NULL DEFAULT 'timer'
                             CHECK (source IN ('timer', 'manual')),
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("sessions", "daily_record_id", { name: "idx_sessions_daily_record_id" });
  pgm.createIndex("sessions", ["user_id", "session_start_ts"], {
    name: "idx_sessions_user_start_ts",
    order: { session_start_ts: "DESC" },
  });

  // weekly_reviews
  pgm.sql(`
    CREATE TABLE weekly_reviews (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start_date     DATE NOT NULL,
      keep                TEXT NOT NULL DEFAULT '',
      problem             TEXT NOT NULL DEFAULT '',
      try                 TEXT NOT NULL DEFAULT '',
      pledge              TEXT NOT NULL DEFAULT '',
      used_builtin_quote  BOOLEAN NOT NULL DEFAULT false,
      builtin_quote_index INT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (user_id, week_start_date)
    );
  `);

  pgm.createIndex("weekly_reviews", ["user_id", "week_start_date"], {
    name: "idx_weekly_reviews_user_week",
    order: { week_start_date: "DESC" },
  });

  pgm.sql(`
    CREATE TRIGGER trg_weekly_reviews_updated_at
    BEFORE UPDATE ON weekly_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // routine_settings
  pgm.sql(`
    CREATE TABLE routine_settings (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TRIGGER trg_routine_settings_updated_at
    BEFORE UPDATE ON routine_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // routine_days
  pgm.sql(`
    CREATE TABLE routine_days (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      routine_id  UUID NOT NULL REFERENCES routine_settings(id) ON DELETE CASCADE,
      day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      enabled     BOOLEAN NOT NULL DEFAULT false,
      start_time  TIME,
      logic_id    UUID REFERENCES study_logics(id) ON DELETE SET NULL,

      UNIQUE (routine_id, day_of_week)
    );
  `);

  // app_settings
  pgm.sql(`
    CREATE TABLE app_settings (
      id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      auto_start_on_category_select   BOOLEAN NOT NULL DEFAULT false,
      last_used_logic_id              UUID REFERENCES study_logics(id) ON DELETE SET NULL,
      data_format_version             TEXT NOT NULL DEFAULT '1',
      first_launch_date               DATE,
      has_seen_onboarding             BOOLEAN NOT NULL DEFAULT false,
      updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TRIGGER trg_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ============================================================
  // 어드민/운영 테이블
  // ============================================================

  // notices
  pgm.sql(`
    CREATE TABLE notices (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      display_type  TEXT NOT NULL CHECK (display_type IN ('banner', 'popup')),
      starts_at     TIMESTAMPTZ,
      ends_at       TIMESTAMPTZ,
      target        TEXT,
      is_published  BOOLEAN NOT NULL DEFAULT false,
      created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TRIGGER trg_notices_updated_at
    BEFORE UPDATE ON notices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // quotes (명언 CRUD — 정적 데이터 이관 대상, 데이터 이관은 S4)
  pgm.sql(`
    CREATE TABLE quotes (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content     TEXT NOT NULL CHECK (char_length(content) <= 200),
      source      TEXT CHECK (char_length(source) <= 50),
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TRIGGER trg_quotes_updated_at
    BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // account_suspensions (정지 이력)
  pgm.sql(`
    CREATE TABLE account_suspensions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason           TEXT NOT NULL,
      suspended_until  TIMESTAMPTZ,
      created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("account_suspensions", "user_id");

  // admin_audit_log (어드민 액션 who/what/when/on_whom)
  pgm.sql(`
    CREATE TABLE admin_audit_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
      action          TEXT NOT NULL,
      target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
      detail          JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.createIndex("admin_audit_log", "actor_user_id");
  pgm.createIndex("admin_audit_log", "target_user_id");
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function down(pgm) {
  // 의존성 역순으로 DROP
  pgm.sql("DROP TABLE IF EXISTS admin_audit_log CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS account_suspensions CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS quotes CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS notices CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS app_settings CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS routine_days CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS routine_settings CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS weekly_reviews CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS sessions CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS snapshot_categories CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS logic_snapshots CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS daily_records CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS categories CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS study_logics CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS password_reset_tokens CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS email_verification_tokens CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS refresh_tokens CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS user_identities CASCADE;");
  pgm.sql("DROP TABLE IF EXISTS users CASCADE;");
  pgm.sql("DROP FUNCTION IF EXISTS set_updated_at CASCADE;");
}
