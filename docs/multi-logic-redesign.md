# 데이터 모델 재설계안: 하루 다중 로직 지원

- 작성일: 2026-07-07
- 상태: **백엔드 구현 완료(2026-07-07)** — Option A 채택, B1~B6 적용. 프론트(F1~F6)는 별도 단계에서 진행 예정.
- 대상: `study-tracker-api`(백엔드), `study-tracker`(프론트) — `daily_records` / `sessions` / `logic_snapshots` 도메인

---

## 0. 문제 정의

현재 구조는 **"하루 = 로직 1개"** 를 데이터 모델 수준에서 강제한다.

1. `daily_records`는 `UNIQUE(user_id, date)` — 하루에 레코드가 정확히 1개만 존재할 수 있다.
2. `logic_snapshots`는 `UNIQUE(daily_record_id)` — 레코드당 스냅샷도 1개뿐이며, 그 날 **가장 먼저** 세션을 추가한 로직의 스냅샷으로 고정된다(`ON CONFLICT (daily_record_id) DO NOTHING`).
3. `sessions`는 `daily_record_id`(날짜 컨테이너)와 `category_id`(단순 TEXT, FK 없음)만 가지고 있어, "이 세션이 어느 로직 소속인지"는 스스로 알지 못하고 **자신이 속한 레코드의 스냅샷**에 얹혀 추론된다.

따라서 하루 중 로직을 바꾸면:
- 백엔드: 새 로직으로 세션을 추가해도 `daily_records.logic_id`는 갱신되지 않고(첫 upsert 이후 `updated_at`만 갱신), 스냅샷도 추가되지 않는다. 두 번째 로직의 카테고리는 그 날의 `snapshot_categories`에 없으므로 조회 시 매칭이 안 된다.
- 프론트(`TodayStudy.tsx` L860): `selectedLogic.categories.find(c => c.id === sess.categoryId)` — **현재 화면에서 선택된 로직** 기준으로 과거 세션의 카테고리명을 찾는다. 로직을 바꾸는 순간 이전 세션은 `'알 수 없음'`으로 표시된다.

즉 버그는 "프론트 조회 로직"과 "데이터 모델(하루 1로직 고정)" 두 층에 걸쳐 있고, 데이터 모델을 고치지 않으면 프론트만 고쳐도 근본적으로 해결되지 않는다.

---

## 1. 현재 스키마 실측 요약

근거: `migrations/1750000000000_s1-t01-initial-schema.js`, `migrations/1750000000001_s1-t02-fix-data-format-version.js`

| 테이블 | 주요 컬럼 | 제약 | 비고 |
|---|---|---|---|
| `study_logics` | id, user_id, name(≤20자), total_target_minutes(1~1440) | - | 로직 원본. 수정/삭제 가능(라이브) |
| `categories` | id, logic_id, user_id, name, color_var, target_minutes, target_percent, sort_order | FK `logic_id → study_logics ON DELETE CASCADE` | 카테고리 원본. 로직 삭제 시 함께 삭제 |
| `daily_records` | id, user_id, date, logic_id(nullable) | **`UNIQUE(user_id, date)`**, FK `logic_id → study_logics ON DELETE SET NULL` | **하루당 1행.** 날짜 컨테이너 겸 "그 날의 로직" 포인터 |
| `logic_snapshots` | id, daily_record_id, logic_name, total_target_minutes | **`UNIQUE(daily_record_id)`** (1:1) | 레코드 최초 세션 추가 시점의 로직 이름/목표시간 박제 |
| `snapshot_categories` | id, snapshot_id, category_id(TEXT, FK 없음), name, color_var, target_minutes, target_percent, sort_order | FK `snapshot_id → logic_snapshots ON DELETE CASCADE` | 스냅샷 시점 카테고리 박제 |
| `sessions` | id, daily_record_id, user_id, category_id(TEXT, FK 없음), session_start_ts, session_end_ts, duration_minutes, is_manually_edited, edited_at, source | FK `daily_record_id → daily_records ON DELETE CASCADE` | **logic_id 컬럼 없음.** 소속 로직은 `daily_record_id`를 통해서만 간접적으로 알 수 있음 |
| `weekly_reviews` | user_id, week_start_date, keep/problem/try/pledge 등 | `UNIQUE(user_id, week_start_date)` | 회고 텍스트만 저장. daily_records를 DB 레벨에서 직접 조인하지 않음(프론트가 주간 날짜별로 `GET /daily-records/:date`를 개별 호출해 클라이언트에서 합산) |
| `routine_days` | routine_id, day_of_week, enabled, start_time, logic_id | FK `logic_id → study_logics ON DELETE SET NULL` | 요일별 "시작 시 자동 선택될 로직" 설정. 이번 재설계와 무관(독립) |
| `app_settings` | last_used_logic_id 등 | - | 이번 재설계와 무관(독립) |

핵심 흐름(`daily-records.repository.ts: upsertRecordAndAddSession`):
1. `INSERT INTO daily_records (...) ON CONFLICT (user_id, date) DO UPDATE SET updated_at = now() RETURNING *` — 트랜잭션 내 upsert.
2. `logicSnapshot`이 오면 `INSERT INTO logic_snapshots (...) ON CONFLICT (daily_record_id) DO NOTHING` — **최초 1회만 반영**, 이후 다른 로직으로 세션을 추가해도 무시됨.
3. `sessions` INSERT (`category_id`는 검증 없는 TEXT).

프론트 `SessionCreateSchema`/API 호출부(`TodayStudy.tsx`)는 세션 추가 시 매번 `logicId` + `logicSnapshot`을 함께 보내고 있어(재시도 큐 대응 주석 확인, L162 부근), **백엔드가 이를 받아들이지 않는 구조**가 원인이다. 즉 프론트는 이미 "매번 로직 정보를 함께 보낸다"는 전제로 짜여 있고, 백엔드 스키마만 하루 1로직으로 잠겨 있다.

---

## 2. 설계 옵션 비교

### Option A — `daily_records`를 (user_id, date, logic_id) 단위로 다중 허용 (★ 권장)

하루 안에서 **로직이 바뀔 때마다 별도의 `daily_records` 행**을 만든다. 즉 `daily_records` 한 행 = "이 날, 이 로직으로 활동한 그룹". 세션은 지금처럼 `daily_record_id`에만 매달리고, 스키마 변경은 유니크 제약 완화뿐이다.

- `UNIQUE(user_id, date)` → `UNIQUE(user_id, date, logic_id)`
- 같은 날 같은 로직으로 다시 돌아오면(A→B→A) 기존 (date,logic) 행에 세션이 계속 붙는다(자연스러운 병합, 별도 로직 불필요).
- `sessions`, `logic_snapshots`, `snapshot_categories` **구조 변경 없음**.

### Option B — `sessions`에 logic_id + 스냅샷을 직접 부여, `daily_records`는 순수 날짜 컨테이너 유지

`daily_records`는 하루 1행을 유지하고, 대신 `sessions`에 `logic_id`(및 소속 스냅샷 참조)를 추가한다. 그룹화는 조회 시 `sessions`를 `logic_id`로 GROUP BY 해서 만든다.

단, 스냅샷 중복 저장을 피하려면 `logic_snapshots`의 유니크 제약을 `UNIQUE(daily_record_id)` → `UNIQUE(daily_record_id, logic_id)`로 바꾸고, `sessions`에 `snapshot_id` FK를 추가해야 한다 — 결국 "다중성이 어디 있는가"만 다를 뿐 Option A와 테이블 개수·제약 복잡도가 사실상 같아지고, 대신 매 조회 쿼리마다 GROUP BY/윈도우 함수로 그룹을 **애플리케이션이 재구성**해야 하는 차이가 생긴다.

### Option C — 2단계 모델: `daily_records`(날짜, 1행) + 신규 `daily_logic_groups`(로직 그룹, N행)

`daily_records`에서 `logic_id`를 아예 제거해 순수 날짜 부모로 만들고, 그 아래 `daily_logic_groups(daily_record_id, logic_id, ...)`를 신설해 `logic_snapshots`/`sessions`가 이 그룹 테이블을 참조하도록 한다. 미래에 "로직 무관 일자 단위 메타데이터"(예: 하루 총평, 로직과 무관한 태그)가 필요해지면 붙일 자리가 생긴다는 장점이 있지만, 지금은 그런 요구가 없고 `sessions`의 FK 대상을 통째로 바꿔야 해 마이그레이션이 A보다 무겁다.

### 비교표

| 기준 | Option A (daily_records 다중화) | Option B (sessions에 logic_id) | Option C (2단계: 날짜부모+로직그룹 자식) |
|---|---|---|---|
| 정규화/중복 | 낮음. 스냅샷은 여전히 (레코드당) 1개, 세션 컬럼 변경 없음 | 중간. `logic_snapshots` 유니크를 (record,logic)로 바꿔야 중복 방지 가능 | 낮음(A와 동일 수준이나 테이블 하나 더 생김) |
| 그룹화 쿼리 난이도 | **매우 쉬움** — `daily_record_id` = 그룹 자체. `GROUP BY` 불필요 | 어려움 — 매 조회마다 `sessions`를 logic_id로 GROUP BY, 스냅샷 조인 필요 | 쉬움 (A와 동일하나 조인 1홉 추가) |
| 스냅샷 일관성 | 그대로 유지(레코드=스냅샷 1:1 불변) | 유니크 제약 변경 필요, 세션마다 snapshot_id 채워야 함(놓치기 쉬움) | 그대로 유지 |
| 프론트 변경량 | 중간 — 날짜별로 배열(그룹 여러 개)을 다루도록 훅/컴포넌트 조정 | 중간~큼 — 위와 동일 + 클라이언트도 별도 그룹화 로직 필요 | 중간 (A와 동일) |
| 통계/주간회고 영향 | "일 합계"는 같은 날짜의 형제 레코드들을 SUM하면 됨(단순 쿼리) | 동일하게 GROUP BY 필요, 산출 로직 위치만 다름 | 동일 |
| 유니크 제약/충돌 위험 | `UNIQUE(user_id,date,logic_id)` — 로직 삭제로 `logic_id`가 NULL이 되는 레코드가 여럿이어도 Postgres는 NULL끼리 중복으로 보지 않아 충돌 없음(실사용상 위험 낮음, 근거는 §6) | `logic_snapshots` 유니크 재정의 + `sessions.snapshot_id` NOT NULL 강제 필요 | A와 동일 + `daily_logic_groups` 유니크 별도 관리 |
| 마이그레이션 무게 | **가장 가벼움**(제약 1개 교체) | 중간(테이블 1개 재정의 + 세션 컬럼 추가) | 무거움(신규 테이블 + FK 대상 전환 + 데이터 이관) |
| 코드량("단순한 코드" 원칙) | 최소 — 백엔드 리포지토리 조회는 이미 배열 반환 구조라 그대로 활용 가능 | 큼 — 모든 읽기 경로에 그룹화 로직 신규 작성 | 중간 |

---

## 3. 권장안: **Option A**

**선정 근거**
1. 요구사항 2번("기록은 스스로 어느 로직/카테고리인지 안다")은 세션이 아니라 **그 세션이 속한 레코드(그룹)**가 스냅샷을 갖고 있으면 자동으로 충족된다 — Option A는 이 구조를 이미 가진 기존 스키마를 유니크 제약만 완화해 그대로 재사용한다.
2. 그룹화 표기(로직 > 카테고리)가 "쿼리로 GROUP BY 해서 만드는 것"이 아니라 "테이블 행 자체가 그룹"이 되므로, 읽기 경로(오늘 기록/달력 상세/주간회고) 어디서든 별도 집계 로직을 새로 작성할 필요가 없다. CLAUDE.md의 "최소한의 코드로 요구사항 충족" 원칙에 가장 부합.
3. `sessions`, `logic_snapshots`, `snapshot_categories` 테이블은 **한 글자도 안 바뀐다** — 회귀 위험이 가장 작다.
4. 프로덕션 데이터가 사실상 없는(구글 1 + 테스트 1 계정) 지금이 제약 변경의 비용이 가장 낮은 시점이며, Option A는 그 이점을 가장 잘 활용한다(기존 행이 새 제약을 자동으로 만족 — §6 참고).

**트레이드오프(인지하고 감수)**
- "하루" 단위 롤업(총 학습시간, 전체 달성률, 레인보우 뱃지)이 이제 "같은 날짜를 공유하는 여러 레코드의 합산"으로 재정의되어야 한다 — 이는 Option B/C를 택해도 동일하게 발생하는 문제이므로 A만의 단점은 아니다. 다만 **이 합산 정책 자체(로직별로 나눠 보여줄지, 날짜 전체로 합칠지)는 이 문서에서 확정하지 않고 §8 "확인 필요"로 남긴다.**

---

## 4. 권장안(Option A) 구체 스키마 변경

> 아래는 SQL 스케치 수준이며, 실제 마이그레이션 파일은 이 문서 승인 후 별도로 작성한다. 실제 제약 이름은 초기 마이그레이션에서 `pgm.sql` 원문 CREATE TABLE 안에 인라인으로 선언되어 Postgres가 자동 명명했으므로(`UNIQUE (user_id, date)`), **정확한 제약명은 구현 단계에서 `\d daily_records`로 재확인 필요**(추정: `daily_records_user_id_date_key`).

```sql
-- up
-- 1) 기존 UNIQUE(user_id, date) 제거
ALTER TABLE daily_records
  DROP CONSTRAINT daily_records_user_id_date_key; -- 확인 필요: 실제 제약명

-- 2) (user_id, date, logic_id) 단위로 재정의
--    logic_id가 NULL인 레코드(로직 삭제 후)는 NULL끼리 서로 다른 값 취급되어 충돌하지 않음(§6)
ALTER TABLE daily_records
  ADD CONSTRAINT daily_records_user_date_logic_key UNIQUE (user_id, date, logic_id);

-- 3) 같은 날짜의 여러 그룹을 시간순(최초 세션 순)으로 안정 정렬하기 위한 보조 인덱스
--    (기존 idx_daily_records_user_date는 유지 — 월별 목록 조회의 date 범위 스캔에 계속 사용)
CREATE INDEX idx_daily_records_user_date_created
  ON daily_records (user_id, date, created_at);

-- down
DROP INDEX IF EXISTS idx_daily_records_user_date_created;
ALTER TABLE daily_records
  DROP CONSTRAINT daily_records_user_date_logic_key;
ALTER TABLE daily_records
  ADD CONSTRAINT daily_records_user_id_date_key UNIQUE (user_id, date);
  -- 주의: down 시점에 이미 같은 날짜에 2개 이상의 로직 그룹이 쌓여 있으면
  -- 이 ADD CONSTRAINT 자체가 UNIQUE 위반으로 실패한다. §7 롤백 전략 참고.
```

`logic_snapshots`, `snapshot_categories`, `sessions`: **변경 없음.** (레코드=그룹 단위로 스냅샷 1:1 관계가 그대로 유지되므로 기존 `UNIQUE(daily_record_id)`가 여전히 정확한 의미를 가진다.)

애플리케이션 레벨 변경(SQL은 아니지만 스키마 변경에 종속되는 부분):
- `upsertRecordAndAddSession`의 `INSERT ... ON CONFLICT (user_id, date) DO UPDATE ...` → `ON CONFLICT (user_id, date, logic_id) DO UPDATE ...`로 충돌 타깃 변경.
- `SessionCreateSchema.logicId`/`logicSnapshot`을 `optional()` → **필수**로 강화(프론트가 이미 매번 채워서 보내고 있어 안전, §5).

---

## 5. API 영향

| 항목 | 현재 | 변경 후 |
|---|---|---|
| `GET /daily-records/:date` | 단일 `DailyRecordResponse` (404 = 기록 없음) | **`DailyRecordResponse[]`** (그 날짜의 로직 그룹 배열, 없으면 `200 []`). `Errors.DAILY_RECORD_NOT_FOUND()` 분기 제거 |
| `GET /daily-records?year&month` | 날짜당 1개씩 담긴 배열 | 그대로 배열 반환(반환 타입 시그니처 자체는 동일)이나, **같은 date를 가진 원소가 여러 개 존재할 수 있음**으로 의미 변경. 정렬 기준에 `created_at` 보조 추가 |
| `POST /daily-records/:date/sessions` | `logicId`/`logicSnapshot` optional | **`logicId` 필수, `logicSnapshot` 필수**(zod). 내부적으로 `(date, logicId)` 조합으로 레코드 upsert |
| `PUT /daily-records/:date/sessions/:sessionId` | `categoryId` 임의 문자열 허용(그룹 소속 검증 없음) | 변경 범위 밖이나, **세션이 속한 그룹의 `snapshot_categories.category_id`에 존재하는 값인지 검증 추가를 권장**(§8 확인 필요 — 이번 재설계 필수 범위는 아님) |
| `DELETE /daily-records/:date/sessions/:sessionId` | 변경 없음 | 변경 없음 |

`daily-records.repository.ts`의 `findByDateOwned` → 복수형(`findGroupsByDate` 등으로 개명 검토), `service.getDailyRecord` → `getDailyRecordGroups`. `daily-records.types.ts`의 응답 인터페이스 자체(`DailyRecordResponse`)는 필드 변경 없이 **배열로 감싸지는 지점만** 바뀐다.

`logics`, `routine`, `weekly-reviews`, `settings` 모듈 API는 이번 변경과 무관(스키마·엔드포인트 변경 없음).

---

## 6. 프론트 영향

핵심 원칙: **`Session`, `DailyRecord` 타입 필드 자체는 바뀌지 않는다.** "하루=배열"이라는 사실만 소비하는 쪽(훅/컴포넌트)에서 반영하면 되고, 이는 이미 `fetchMonthlyRecords`가 배열을 반환하던 기존 패턴을 그대로 확장하는 것이라 타입 변경이 최소화된다.

| 파일 | 변경 요지 |
|---|---|
| `src/types/entities.ts` | **필드 변경 없음.** (`Session`, `DailyRecord`, `LogicSnapshot` 그대로) |
| `src/api/daily-records.ts` | `fetchDailyRecord(date)`: 반환 타입 `DailyRecord \| null` → **`DailyRecord[]`** (빈 배열 = 기록 없음, try/catch 404 분기 제거). `SessionAddInput.logicId`/`logicSnapshot`: optional → **필수** |
| `src/hooks/useCalendarMonth.ts` | `recordMap: Map<date, DailyRecord>` → **`Map<date, DailyRecord[]>`**. `CalendarDayInfo.record` → **`records: DailyRecord[]`**. 달성률/무지개뱃지 롤업 계산을 "그룹별"과 "날짜 합산" 중 무엇으로 할지는 §8 정책 확정 후 구현 |
| `src/components/calendar/DayDetail.tsx` | 현재 "스냅샷 1개 → 카테고리 카드 리스트" 단일 렌더링 구조를, **로직 그룹마다 섹션을 반복 렌더링**(그룹 헤더 = 로직명, 그 아래 기존 카테고리 카드 리스트)하는 구조로 리팩터. `record.sessions.filter(s => s.categoryId === cat.id)` 로직은 그룹 스코프 안에서는 그대로 재사용 가능 |
| `src/pages/TodayStudy.tsx` | **버그의 직접 원인 라인(L860) 제거**: `selectedLogic.categories.find(...)` 대신, 세션이 속한 **그룹 자신의 `logicSnapshot.categories`**에서 찾도록 변경. "오늘 세션 내역" 섹션은 현재 선택 로직 하나만이 아니라 **오늘의 모든 그룹**을 로직별로 나눠 보여주도록 확장 필요(요구사항 1,2 직접 대응) |
| `src/pages/WeeklyReview.tsx` (`useWeekRecords`) | 요일별로 `DailyRecord`(단수) 저장하던 것을 `DailyRecord[]`로 변경, 주간 합산 로직에서 같은 날짜의 여러 그룹을 SUM하도록 조정 |

---

## 7. 마이그레이션/롤아웃 전략

**전제**: 프로덕션 DB에는 구글 계정 1개 + 테스트 계정 1개의 데이터만 존재. 각 기존 `daily_records` 행은 (설계상) 이미 정확히 하나의 `(user_id, date, logic_id)` 조합이므로, **신규 `UNIQUE(user_id, date, logic_id)` 제약을 기존 데이터가 자동으로 만족한다 — 백필 불필요.**

- 데이터 처리: 없음(그대로 유지). 굳이 백필/초기화 스크립트를 만들 필요가 없다 — 이번 케이스는 "제약 완화" 방향의 마이그레이션이라 하위 호환이 자동 성립한다.
- 배포 순서: (1) DB 마이그레이션 적용 → (2) 백엔드 배포(zod 스키마 강화 + 응답 배열화) → (3) 프론트 배포. 아직 상용 트래픽이 없는 pre-launch 상태이므로 API 버전 분기(v2 엔드포인트 병행 운영 등) 없이 한 번에 교체 가능.
- 롤백: `down` 마이그레이션은 **"그 시점까지 하루에 로직 그룹이 2개 이상 쌓인 날짜가 없을 때만" 안전하다.** 배포 후 실사용으로 다중 로직 기록이 하나라도 생기면, 기존 `UNIQUE(user_id, date)`로 되돌리는 `ADD CONSTRAINT`가 즉시 중복키 위반으로 실패한다. 롤백이 필요해지면 사전에 "같은 (user_id,date)의 여러 그룹을 병합하거나 최신 것만 남기고 나머지를 삭제"하는 수동 정리가 선행되어야 함 — 애플리케이션 코드(백엔드) 롤백은 스키마 롤백 없이도 가능(응답을 다시 단일 객체로 되돌리는 것은 배열의 첫 원소만 쓰면 되므로 무손실 다운그레이드 가능)하니, **실제 운영에서는 "스키마는 유지한 채 API/프론트만 되돌리는" 롤백을 우선 고려**할 것을 권장.

---

## 8. 정책 확정 (2026-07-07, 뀨대표님 확정)

구현 단계(백엔드 B1~B6, 2026-07-07 완료)에서 아래 정책이 확정되었다.

1. **하루 종합 달성률/레인보우 하트·별 뱃지**: **로직 그룹별로 각각** 계산·표시한다(그룹 합산 안 함). 백엔드는 그룹 배열(각 그룹의 `achievementCache`)만 정확히 제공하고, 그룹별 표시는 프론트(F2~F4) 책임.
2. **캘린더 달 뷰 하루 셀의 대표 지표**: **로직별 카테고리 달성 + 로직 수만큼 별·하트를 누적** 표시(그룹 합산 %나 첫 로직만 보여주는 방식은 채택하지 않음). 프론트(F2) 구현 시 이 정책 적용.
3. **TodayStudy 상단 요약("오늘 총 학습시간" 등)**: 이번 결정 범위에서 별도 확정 없이 F4(프론트) 진행 시 그룹별 표기를 우선 적용(§8-1 정책과 일관).
4. **세션 수정(`PUT .../sessions/:sessionId`) `categoryId` 검증**: **같은 그룹(로직) 카테고리로만 변경 허용**, 다른 로직의 카테고리로 변경은 차단(구현 완료 — B6, `Errors.SESSION_CATEGORY_INVALID()` 400).
5. 로직 없이(logicId 없이) 세션을 생성하는 경로: 코드 재확인 결과 없음 확인 후 `SessionCreateSchema.logicId`/`logicSnapshot`을 필수화(B3 구현 완료).
6. 같은 날 같은 로직으로 A→B→A처럼 여러 번 오갈 때 **전환 횟수/구간 히스토리는 기록하지 않는다** — 그룹 병합만 하고(기존 (date,logic) 행에 세션이 계속 붙음) 전환 이력 노출 기능은 이번 범위에서 제외.

### 백엔드 구현 완료 요약 (2026-07-07)

B1~B6 전 항목 구현 완료. 상세는 `migrations/1783397322148_s2-t01-daily-records-multi-logic.js`,
`src/modules/daily-records/*` 참고. 프론트(F1~F6)는 별도 단계에서 진행.

---

## 9. 구현 태스크 분해

### 백엔드 (`study-tracker-api`)

| # | 태스크 | 의존성 |
|---|---|---|
| B1 | 마이그레이션 신규 작성: `UNIQUE(user_id,date)` → `UNIQUE(user_id,date,logic_id)` 교체 + 보조 인덱스 추가 | §8 정책과 무관하게 선행 가능 |
| B2 | `daily-records.repository.ts`: upsert `ON CONFLICT` 타깃 변경, `findByDateOwned` → 복수 그룹 반환으로 개명/시그니처 변경, 정렬에 `created_at` 보조키 추가 | B1 |
| B3 | `daily-records.types.ts`: `SessionCreateSchema.logicId/logicSnapshot` 필수화 | B1 |
| B4 | `daily-records.service.ts`/`controller.ts`: 단일→배열 응답 전환, `DAILY_RECORD_NOT_FOUND` 에러 분기 제거 | B2, B3 |
| B5 | `tests/daily-records.test.ts` 갱신: 기존 단일-레코드 케이스 조정 + "하루 2개 로직 전환" 신규 시나리오 추가 | B2~B4 |
| B6 | (선택, §8-4 확정 시) 세션 수정 시 `categoryId` 그룹 소속 검증 추가 | B4, 정책 확정 |

### 프론트 (`study-tracker`)

| # | 태스크 | 의존성 |
|---|---|---|
| F1 | `src/api/daily-records.ts`: `fetchDailyRecord` 반환 배열화, `SessionAddInput` 필수 필드 반영 | 백엔드 계약 확정(B3, B4) |
| F2 | `src/hooks/useCalendarMonth.ts`: `recordMap`/`CalendarDayInfo` 배열 구조 전환 + §8-1,2 정책 반영 | F1, §8 정책 |
| F3 | `src/components/calendar/DayDetail.tsx`: 로직 그룹별 섹션 반복 렌더링으로 리팩터 | F2 |
| F4 | `src/pages/TodayStudy.tsx`: L860 버그 라인 제거(그룹 스냅샷 기준 조회로 교체), "오늘 세션 내역"을 전체 그룹 기준으로 확장 | F1 |
| F5 | `src/pages/WeeklyReview.tsx`(`useWeekRecords`): 배열 합산 반영 | F1, §8-1 정책 |
| F6 | 프론트 테스트 보강(현재 관련 테스트 파일 없음 — 그룹 렌더링/버그 회귀 케이스 신규 작성) | F1~F5 |

### 다른 예정 UI 작업과의 파일 충돌 지점

- **달력 "월요일 시작" 변경**: `useCalendarMonth.ts`, `Calendar.tsx`, `CalendarGrid.tsx`를 이번 재설계(F2)와 동일하게 건드림 → **F2가 먼저 머지된 뒤** 요일 시작점 변경을 얹는 순서 권장(구조 변경이 더 근본적).
- **세션 시간피커 UI 추가**: `TodayStudy.tsx`의 세션 카드, `DayDetail.tsx`의 세션 항목 마크업을 건드림 → 이번 재설계로 세션 카드 렌더링 구조(F3, F4)가 바뀌므로, **시간피커 작업은 F3/F4 머지 이후** 진행 권장.
- **문구(카피) 변경**: 특정 파일에 국한되지 않고 광범위 → 이번 구조 변경 PR이 먼저 머지된 뒤 진행해야 diff 충돌이 최소화됨.
