/**
 * S2-T01: 하루 다중 로직 지원 — daily_records 유니크 제약 완화
 *
 * 설계 문서: docs/multi-logic-redesign.md (Option A 채택 확정)
 *
 * - UNIQUE(user_id, date) → UNIQUE(user_id, date, logic_id) 로 교체.
 *   하루 안에서 로직이 바뀌면 (date, logic_id) 조합별로 daily_records 행이
 *   추가로 생기고, 세션/스냅샷은 지금처럼 daily_record_id에만 매달린다.
 * - 같은 날짜의 여러 로직 그룹을 안정적으로(최초 생성 순) 정렬하기 위한
 *   보조 인덱스 (user_id, date, created_at) 추가.
 *
 * 배포 시점 기준 실사용 데이터는 daily_records 1건뿐이며, 기존 행은
 * (설계상) 이미 하나의 (user_id, date, logic_id) 조합이므로 신규 제약을
 * 자동으로 만족한다 — 백필 불필요 (문서 §7).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE daily_records
      DROP CONSTRAINT daily_records_user_id_date_key;
  `);

  pgm.sql(`
    ALTER TABLE daily_records
      ADD CONSTRAINT daily_records_user_date_logic_key UNIQUE (user_id, date, logic_id);
  `);

  pgm.createIndex("daily_records", ["user_id", "date", "created_at"], {
    name: "idx_daily_records_user_date_created",
  });
};

/**
 * 주의(문서 §7): 배포 후 실사용으로 같은 (user_id, date)에 로직 그룹이
 * 2개 이상 쌓인 상태에서 down을 실행하면, 아래 ADD CONSTRAINT가 즉시
 * UNIQUE 위반으로 실패한다. 롤백 전에 중복 (user_id, date)의 여러 그룹을
 * 수동으로 병합/정리해야 한다.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropIndex("daily_records", ["user_id", "date", "created_at"], {
    name: "idx_daily_records_user_date_created",
    ifExists: true,
  });

  pgm.sql(`
    ALTER TABLE daily_records
      DROP CONSTRAINT daily_records_user_date_logic_key;
  `);

  pgm.sql(`
    ALTER TABLE daily_records
      ADD CONSTRAINT daily_records_user_id_date_key UNIQUE (user_id, date);
  `);
};
