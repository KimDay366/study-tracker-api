/**
 * S1-T02: app_settings.data_format_version DEFAULT 값 정정
 *
 * 문제: 초기 스키마에서 DEFAULT '1'로 생성되었으나
 *       settings.repository.ts의 DATA_FORMAT_VERSION 상수는 '1.0.0'을 사용함.
 *       서버가 INSERT 시 항상 '1.0.0'을 명시적으로 지정하므로 신규 데이터는 정상이나,
 *       DB DEFAULT만 의존하는 경우를 대비해 통일한다.
 *
 * 영향: 기존 데이터 중 data_format_version = '1'인 행을 '1.0.0'으로 업데이트.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function up(pgm) {
  // DEFAULT 값 변경
  pgm.sql(`
    ALTER TABLE app_settings
      ALTER COLUMN data_format_version SET DEFAULT '1.0.0';
  `);

  // 기존 '1' 값을 '1.0.0'으로 정정
  pgm.sql(`
    UPDATE app_settings SET data_format_version = '1.0.0'
    WHERE data_format_version = '1';
  `);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function down(pgm) {
  pgm.sql(`
    ALTER TABLE app_settings
      ALTER COLUMN data_format_version SET DEFAULT '1';
  `);

  pgm.sql(`
    UPDATE app_settings SET data_format_version = '1'
    WHERE data_format_version = '1.0.0';
  `);
}
