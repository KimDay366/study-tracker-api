/**
 * S2-T02: 타이머 세션 중복 저장 방지 — 내용 기반 부분 유니크 인덱스
 *
 * 배경: 정지 버튼 연타/새로고침 재전송 시, 클라이언트가 매번 새 UUID를 만들어
 *   보내면 기존 `ON CONFLICT (id)` 멱등이 무력화되어 동일 세션이 여러 행으로
 *   중복 저장되던 문제. 프런트에서 세션당 id를 고정하도록 고쳤고, 백엔드에도
 *   이중 안전망으로 내용 기반 중복 방지를 둔다.
 *
 * 핵심: 타이머 세션의 시작 시각(session_start_ts)은 연타·재시도와 무관하게
 *   불변이므로 (user_id, session_start_ts)가 자연 dedup 키가 된다.
 *   source='timer'로 한정 — 수동 기록(manual)은 같은 시작 시각을 의도적으로
 *   여러 번 남길 여지가 있어 제외한다.
 *
 * 인덱스 생성 전, 이미 쌓인 중복 timer 세션을 정리한다(가장 먼저 생성된 1건만
 * 남김). 정리하지 않으면 UNIQUE 인덱스 생성이 즉시 실패한다.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  // 1) 기존 중복 timer 세션 정리 — (user_id, session_start_ts)별로 created_at이
  //    가장 이른 1건만 남기고 나머지 삭제. 삭제된 행이 속한 daily_record가
  //    비게 되는 일은 없다(중복은 같은 그룹에 쌓이므로 대표 1건이 남는다).
  pgm.sql(`
    DELETE FROM sessions s
    USING (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, session_start_ts
               ORDER BY created_at, id
             ) AS rn
      FROM sessions
      WHERE source = 'timer'
    ) dup
    WHERE s.id = dup.id AND dup.rn > 1;
  `);

  // 2) 내용 기반 부분 유니크 인덱스 — 동일 시작 시각의 timer 세션 중복 차단
  pgm.sql(`
    CREATE UNIQUE INDEX uq_sessions_timer_user_start
      ON sessions (user_id, session_start_ts)
      WHERE source = 'timer';
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS uq_sessions_timer_user_start;`);
};
