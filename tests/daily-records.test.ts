import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { query, closePool } from "../src/lib/db.js";
import dailyRecordsRouter from "../src/modules/daily-records/daily-records.router.js";
import logicsRouter from "../src/modules/logics/logics.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { createTestUser, authHeader } from "./helpers.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/daily-records", dailyRecordsRouter);
app.use("/api/v1/logics", logicsRouter);
app.use(errorHandler);

const TRUNCATE = `TRUNCATE study_logics, categories, routine_settings, routine_days,
  app_settings, daily_records, sessions, logic_snapshots, snapshot_categories,
  weekly_reviews, users RESTART IDENTITY CASCADE`;

const sampleLogic = {
  name: "집중 루틴",
  totalTargetMinutes: 120,
  categories: [
    { name: "수학", colorVar: "--cat-color-01", targetMinutes: 60, targetPercent: 50.0 },
    { name: "영어", colorVar: "--cat-color-02", targetMinutes: 60, targetPercent: 50.0 },
  ],
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    categoryId: crypto.randomUUID(),
    sessionStartTimestamp: 1700000000000,
    sessionEndTimestamp: 1700003600000,
    durationMinutes: 60,
    source: "timer",
    ...overrides,
  };
}

beforeEach(async () => {
  await query(TRUNCATE, []);
});

afterAll(async () => {
  await closePool();
});

describe("daily-records API", () => {
  // ─── GET /:date ─────────────────────────────────────────────────────────────

  it("GET /:date - 기록 없으면 404 DAILY_RECORD_NOT_FOUND", async () => {
    const { accessToken } = await createTestUser("dr1");
    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("DAILY_RECORD_NOT_FOUND");
  });

  it("GET /:date - 세션 추가 후 DailyRecord 반환 (achievementCache 포함)", async () => {
    const { accessToken } = await createTestUser("dr2");

    // 로직 생성
    const logicRes = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(accessToken))
      .send(sampleLogic);
    const logic = logicRes.body;
    const catId = logic.categories[0].id as string;

    // 세션 추가
    const sessionId = crypto.randomUUID();
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send({
        id: sessionId,
        categoryId: catId,
        sessionStartTimestamp: 1705276800000,
        sessionEndTimestamp: 1705280400000,
        durationMinutes: 60,
        source: "timer",
        logicId: logic.id,
        logicSnapshot: {
          name: logic.name,
          totalTargetMinutes: logic.totalTargetMinutes,
          categories: logic.categories.map((c: Record<string, unknown>) => ({
            id: c["id"],
            name: c["name"],
            colorVar: c["colorVar"],
            targetMinutes: c["targetMinutes"],
            targetPercent: c["targetPercent"],
          })),
        },
      });

    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.date).toBe("2024-01-15");
    expect(res.body.logicId).toBe(logic.id);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].id).toBe(sessionId);
    expect(res.body.logicSnapshot).toBeDefined();
    expect(res.body.logicSnapshot.name).toBe("집중 루틴");
    // achievementCache: 60분 / 120분 = 50%
    expect(res.body.achievementCache).not.toBeNull();
    expect(res.body.achievementCache.totalAchievementPercent).toBe(50.0);
  });

  it("GET /:date - 타인 기록 접근 → 404", async () => {
    const u1 = await createTestUser("dr3a");
    const u2 = await createTestUser("dr3b");

    // u1이 세션 추가
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(u1.accessToken))
      .send(makeSession());

    // u2가 조회 시도
    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(u2.accessToken));
    expect(res.status).toBe(404);
  });

  it("GET /:date - 잘못된 날짜 형식 → 400 INVALID_DATE_FORMAT", async () => {
    const { accessToken } = await createTestUser("dr4");
    const res = await request(app)
      .get("/api/v1/daily-records/20240115")
      .set(authHeader(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_FORMAT");
  });

  it("GET /:date - 형식은 맞지만 실존하지 않는 날짜(2026-13-99) → 400 INVALID_DATE_FORMAT", async () => {
    const { accessToken } = await createTestUser("dr4b");
    const res = await request(app)
      .get("/api/v1/daily-records/2026-13-99")
      .set(authHeader(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_FORMAT");
  });

  it("GET /:date - 형식은 맞지만 2월 30일(2024-02-30) → 400 INVALID_DATE_FORMAT", async () => {
    const { accessToken } = await createTestUser("dr4c");
    const res = await request(app)
      .get("/api/v1/daily-records/2024-02-30")
      .set(authHeader(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_FORMAT");
  });

  it("POST /:date/sessions - 실존하지 않는 날짜(2026-13-01) → 400 INVALID_DATE_FORMAT", async () => {
    const { accessToken } = await createTestUser("dr4d");
    const res = await request(app)
      .post("/api/v1/daily-records/2026-13-01/sessions")
      .set(authHeader(accessToken))
      .send(makeSession());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_FORMAT");
  });

  // ─── GET ?year=&month= ───────────────────────────────────────────────────────

  it("GET ?year=&month= - 해당 월 기록 목록 반환", async () => {
    const { accessToken } = await createTestUser("dr5");

    // 1월 15일, 1월 20일에 세션 추가
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession());
    await request(app)
      .post("/api/v1/daily-records/2024-01-20/sessions")
      .set(authHeader(accessToken))
      .send(makeSession());

    const res = await request(app)
      .get("/api/v1/daily-records?year=2024&month=1")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].date).toBe("2024-01-15");
    expect(res.body[1].date).toBe("2024-01-20");
  });

  it("GET ?year=&month= - 기록 없으면 빈 배열", async () => {
    const { accessToken } = await createTestUser("dr6");
    const res = await request(app)
      .get("/api/v1/daily-records?year=2024&month=2")
      .set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET ?year=&month= - 잘못된 쿼리 → 400 VALIDATION_ERROR (field: message 포맷)", async () => {
    const { accessToken } = await createTestUser("dr7");
    const res = await request(app)
      .get("/api/v1/daily-records?year=abc&month=1")
      .set(authHeader(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    // validate() 미들웨어와 동일한 "field: message" 포맷 확인
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message).toMatch(/\w+: .+/);
  });

  // ─── POST /:date/sessions ───────────────────────────────────────────────────

  it("POST /:date/sessions - 201 + SessionResponse 반환", async () => {
    const { accessToken } = await createTestUser("dr8");
    const sessionId = crypto.randomUUID();
    const res = await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send({
        id: sessionId,
        categoryId: crypto.randomUUID(),
        sessionStartTimestamp: 1705276800000,
        sessionEndTimestamp: 1705280400000,
        durationMinutes: 60,
        source: "timer",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(sessionId);
    expect(res.body.durationMinutes).toBe(60);
    expect(res.body.source).toBe("timer");
    expect(res.body.isManuallyEdited).toBe(false);
    expect(res.body.editedAt).toBeNull();
  });

  it("POST /:date/sessions - 동일 UUID 중복 요청 시 멱등 (200 반환, DB row 1개)", async () => {
    const { accessToken } = await createTestUser("dr9");
    const sessionId = crypto.randomUUID();
    const payload = {
      id: sessionId,
      categoryId: crypto.randomUUID(),
      sessionStartTimestamp: 1705276800000,
      sessionEndTimestamp: 1705280400000,
      durationMinutes: 60,
      source: "timer",
    };

    const first = await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(sessionId);

    // DB row 개수 확인
    const dbRes = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(parseInt(dbRes.rows[0].count, 10)).toBe(1);
  });

  it("POST /:date/sessions - 자정 경계 시나리오: 전날+오늘 세션이 별개 daily_record에 저장", async () => {
    const { accessToken } = await createTestUser("dr10");

    // 전날 세션
    const prevSession = makeSession({ sessionStartTimestamp: 1705276800000 });
    // 오늘 세션
    const todaySession = makeSession({ sessionStartTimestamp: 1705363200000 });

    const [res1, res2] = await Promise.all([
      request(app)
        .post("/api/v1/daily-records/2024-01-15/sessions")
        .set(authHeader(accessToken))
        .send(prevSession),
      request(app)
        .post("/api/v1/daily-records/2024-01-16/sessions")
        .set(authHeader(accessToken))
        .send(todaySession),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // 두 날짜 각각 조회
    const [r1, r2] = await Promise.all([
      request(app).get("/api/v1/daily-records/2024-01-15").set(authHeader(accessToken)),
      request(app).get("/api/v1/daily-records/2024-01-16").set(authHeader(accessToken)),
    ]);

    expect(r1.body.sessions).toHaveLength(1);
    expect(r2.body.sessions).toHaveLength(1);
    expect(r1.body.sessions[0].id).toBe(prevSession.id as string);
    expect(r2.body.sessions[0].id).toBe(todaySession.id as string);
  });

  it("POST /:date/sessions - 인증 없음 → 401", async () => {
    const res = await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .send(makeSession());
    expect(res.status).toBe(401);
  });

  // ─── PUT /:date/sessions/:sessionId ─────────────────────────────────────────

  it("PUT /:date/sessions/:sessionId - 세션 수정", async () => {
    const { accessToken } = await createTestUser("dr11");
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send({
        id: sessionId,
        categoryId: crypto.randomUUID(),
        sessionStartTimestamp: 1705276800000,
        sessionEndTimestamp: 1705280400000,
        durationMinutes: 60,
        source: "timer",
      });

    const editedAt = new Date().toISOString();
    const res = await request(app)
      .put(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken))
      .send({
        isManuallyEdited: true,
        editedAt,
        durationMinutes: 45,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sessionId);
    expect(res.body.isManuallyEdited).toBe(true);
    expect(res.body.durationMinutes).toBe(45);
    expect(res.body.editedAt).toBeTruthy();
  });

  it("PUT /:date/sessions/:sessionId - categoryId 변경 반영", async () => {
    const { accessToken } = await createTestUser("dr11b");
    const sessionId = crypto.randomUUID();
    const oldCatId = crypto.randomUUID();
    const newCatId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession({ id: sessionId, categoryId: oldCatId }));

    const res = await request(app)
      .put(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken))
      .send({ categoryId: newCatId, isManuallyEdited: true, editedAt: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBe(newCatId);

    // 재조회로도 영속 확인
    const getRes = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));
    expect(getRes.body.sessions[0].categoryId).toBe(newCatId);
  });

  it("PUT /:date/sessions/:sessionId - categoryId 미전송 시 기존 값 유지", async () => {
    const { accessToken } = await createTestUser("dr11c");
    const sessionId = crypto.randomUUID();
    const catId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession({ id: sessionId, categoryId: catId }));

    const res = await request(app)
      .put(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken))
      .send({ durationMinutes: 30 });

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBe(catId);
    expect(res.body.durationMinutes).toBe(30);
  });

  it("PUT /:date/sessions/:sessionId - 타인 세션 수정 시도 → 404", async () => {
    const u1 = await createTestUser("dr12a");
    const u2 = await createTestUser("dr12b");
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(u1.accessToken))
      .send(makeSession({ id: sessionId }));

    const res = await request(app)
      .put(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(u2.accessToken))
      .send({ isManuallyEdited: true, editedAt: null });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SESSION_NOT_FOUND");
  });

  // ─── DELETE /:date/sessions/:sessionId ──────────────────────────────────────

  it("DELETE /:date/sessions/:sessionId - 세션 삭제 → 204", async () => {
    const { accessToken } = await createTestUser("dr13");
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession({ id: sessionId }));

    const res = await request(app)
      .delete(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken));
    expect(res.status).toBe(204);
  });

  it("DELETE /:date/sessions/:sessionId - 타인 세션 삭제 시도 → 404", async () => {
    const u1 = await createTestUser("dr14a");
    const u2 = await createTestUser("dr14b");
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(u1.accessToken))
      .send(makeSession({ id: sessionId }));

    const res = await request(app)
      .delete(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(u2.accessToken));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SESSION_NOT_FOUND");
  });

  it("achievementCache - sessions가 없으면 null", async () => {
    // sessions이 없는 경우는 daily_record 자체가 없어 404
    // → sessions 추가 후 삭제하는 시나리오
    const { accessToken } = await createTestUser("dr15");
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession({ id: sessionId }));

    // 세션 삭제
    await request(app)
      .delete(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken));

    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.achievementCache).toBeNull();
  });
});
