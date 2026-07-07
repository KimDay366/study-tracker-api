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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LogicBody = any;

async function createLogic(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<LogicBody> {
  const res = await request(app)
    .post("/api/v1/logics")
    .set(authHeader(accessToken))
    .send({ ...sampleLogic, ...overrides });
  return res.body;
}

function toSnapshotPayload(logic: LogicBody) {
  return {
    name: logic.name,
    totalTargetMinutes: logic.totalTargetMinutes,
    categories: logic.categories.map((c: Record<string, unknown>) => ({
      id: c["id"],
      name: c["name"],
      colorVar: c["colorVar"],
      targetMinutes: c["targetMinutes"],
      targetPercent: c["targetPercent"],
    })),
  };
}

// 세션 생성 payload — logicId/logicSnapshot 필수화(B3) 반영, logic 기반으로 조립
function makeSession(logic: LogicBody, overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    categoryId: logic.categories[0].id as string,
    sessionStartTimestamp: 1700000000000,
    sessionEndTimestamp: 1700003600000,
    durationMinutes: 60,
    source: "timer",
    logicId: logic.id as string,
    logicSnapshot: toSnapshotPayload(logic),
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

  it("GET /:date - 기록 없으면 200 빈 배열", async () => {
    const { accessToken } = await createTestUser("dr1");
    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /:date - 세션 추가 후 그룹 배열(길이 1) 반환 (achievementCache 포함)", async () => {
    const { accessToken } = await createTestUser("dr2");
    const logic = await createLogic(accessToken);
    const catId = logic.categories[0].id as string;

    const sessionId = crypto.randomUUID();
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic, { id: sessionId, categoryId: catId }));

    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const group = res.body[0];
    expect(group.date).toBe("2024-01-15");
    expect(group.logicId).toBe(logic.id);
    expect(group.sessions).toHaveLength(1);
    expect(group.sessions[0].id).toBe(sessionId);
    expect(group.logicSnapshot).toBeDefined();
    expect(group.logicSnapshot.name).toBe("집중 루틴");
    // achievementCache: 60분 / 120분 = 50%
    expect(group.achievementCache).not.toBeNull();
    expect(group.achievementCache.totalAchievementPercent).toBe(50.0);
  });

  it("GET /:date - 타인 기록 접근 → 200 빈 배열(본인 것만 보임)", async () => {
    const u1 = await createTestUser("dr3a");
    const u2 = await createTestUser("dr3b");
    const logic = await createLogic(u1.accessToken);

    // u1이 세션 추가
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(u1.accessToken))
      .send(makeSession(logic));

    // u2가 조회 시도 → 자기 기록이 없으니 빈 배열
    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(u2.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
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
    const logic = await createLogic(accessToken);
    const res = await request(app)
      .post("/api/v1/daily-records/2026-13-01/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_FORMAT");
  });

  // ─── 하루 다중 로직(Option A) ────────────────────────────────────────────────

  it("하루 로직 A→B 전환 시 그룹 2개가 생기고 각 그룹이 자기 스냅샷/카테고리를 유지한다", async () => {
    const { accessToken } = await createTestUser("dr-multi1");
    const logicA = await createLogic(accessToken, { name: "로직A" });
    const logicB = await createLogic(accessToken, {
      name: "로직B",
      categories: [
        { name: "독서", colorVar: "--cat-color-03", targetMinutes: 30, targetPercent: 100.0 },
      ],
    });

    const sessionA = makeSession(logicA);
    const sessionB = makeSession(logicB);

    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/v1/daily-records/2024-01-15/sessions")
        .set(authHeader(accessToken))
        .send(sessionA),
      request(app)
        .post("/api/v1/daily-records/2024-01-15/sessions")
        .set(authHeader(accessToken))
        .send(sessionB),
    ]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const groupA = res.body.find((g: LogicBody) => g.logicId === logicA.id);
    const groupB = res.body.find((g: LogicBody) => g.logicId === logicB.id);

    expect(groupA).toBeDefined();
    expect(groupB).toBeDefined();
    expect(groupA.logicSnapshot.name).toBe("로직A");
    expect(groupB.logicSnapshot.name).toBe("로직B");
    expect(groupA.sessions).toHaveLength(1);
    expect(groupB.sessions).toHaveLength(1);
    expect(groupA.sessions[0].id).toBe(sessionA.id);
    expect(groupB.sessions[0].id).toBe(sessionB.id);
    // 각 그룹의 카테고리는 자기 로직의 것만 포함
    expect(groupA.logicSnapshot.categories.map((c: LogicBody) => c.name)).toEqual(["수학", "영어"]);
    expect(groupB.logicSnapshot.categories.map((c: LogicBody) => c.name)).toEqual(["독서"]);
  });

  it("같은 날 같은 로직으로 A→B→A 전환 시 처음/마지막 A 세션은 같은 그룹으로 병합된다", async () => {
    const { accessToken } = await createTestUser("dr-multi2");
    const logicA = await createLogic(accessToken, { name: "로직A" });
    const logicB = await createLogic(accessToken, {
      name: "로직B",
      categories: [
        { name: "독서", colorVar: "--cat-color-03", targetMinutes: 30, targetPercent: 100.0 },
      ],
    });

    const sessionA1 = makeSession(logicA);
    const sessionB1 = makeSession(logicB);
    const sessionA2 = makeSession(logicA);

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(sessionA1);
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(sessionB1);
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(sessionA2);

    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2); // A그룹 1개 + B그룹 1개 (A는 병합)

    const groupA = res.body.find((g: LogicBody) => g.logicId === logicA.id);
    expect(groupA.sessions).toHaveLength(2);
    expect(groupA.sessions.map((s: LogicBody) => s.id).sort()).toEqual(
      [sessionA1.id, sessionA2.id].sort(),
    );
  });

  // ─── GET ?year=&month= ───────────────────────────────────────────────────────

  it("GET ?year=&month= - 해당 월 기록 목록 반환", async () => {
    const { accessToken } = await createTestUser("dr5");
    const logic = await createLogic(accessToken);

    // 1월 15일, 1월 20일에 세션 추가
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic));
    await request(app)
      .post("/api/v1/daily-records/2024-01-20/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic));

    const res = await request(app)
      .get("/api/v1/daily-records?year=2024&month=1")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].date).toBe("2024-01-15");
    expect(res.body[1].date).toBe("2024-01-20");
  });

  it("GET ?year=&month= - 같은 날짜에 로직 그룹이 2개면 원소 2개가 모두 포함된다", async () => {
    const { accessToken } = await createTestUser("dr5b");
    const logicA = await createLogic(accessToken, { name: "로직A" });
    const logicB = await createLogic(accessToken, {
      name: "로직B",
      categories: [
        { name: "독서", colorVar: "--cat-color-03", targetMinutes: 30, targetPercent: 100.0 },
      ],
    });

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logicA));
    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logicB));

    const res = await request(app)
      .get("/api/v1/daily-records?year=2024&month=1")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((g: LogicBody) => g.date === "2024-01-15")).toBe(true);
    const logicIds = res.body.map((g: LogicBody) => g.logicId).sort();
    expect(logicIds).toEqual([logicA.id, logicB.id].sort());
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
    const logic = await createLogic(accessToken);
    const sessionId = crypto.randomUUID();
    const res = await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic, { id: sessionId }));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(sessionId);
    expect(res.body.durationMinutes).toBe(60);
    expect(res.body.source).toBe("timer");
    expect(res.body.isManuallyEdited).toBe(false);
    expect(res.body.editedAt).toBeNull();
  });

  it("POST /:date/sessions - logicId/logicSnapshot 없으면 400 VALIDATION_ERROR", async () => {
    const { accessToken } = await createTestUser("dr8b");
    const res = await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send({
        id: crypto.randomUUID(),
        categoryId: crypto.randomUUID(),
        sessionStartTimestamp: 1705276800000,
        sessionEndTimestamp: 1705280400000,
        durationMinutes: 60,
        source: "timer",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /:date/sessions - 동일 UUID 중복 요청 시 멱등 (200 반환, DB row 1개)", async () => {
    const { accessToken } = await createTestUser("dr9");
    const logic = await createLogic(accessToken);
    const payload = makeSession(logic);

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
    expect(second.body.id).toBe(payload.id);

    // DB row 개수 확인
    const dbRes = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM sessions WHERE id = $1",
      [payload.id],
    );
    expect(parseInt(dbRes.rows[0].count, 10)).toBe(1);
  });

  it("POST /:date/sessions - 자정 경계 시나리오: 전날+오늘 세션이 별개 daily_record에 저장", async () => {
    const { accessToken } = await createTestUser("dr10");
    const logic = await createLogic(accessToken);

    // 전날 세션
    const prevSession = makeSession(logic, { sessionStartTimestamp: 1705276800000 });
    // 오늘 세션
    const todaySession = makeSession(logic, { sessionStartTimestamp: 1705363200000 });

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

    expect(r1.body[0].sessions).toHaveLength(1);
    expect(r2.body[0].sessions).toHaveLength(1);
    expect(r1.body[0].sessions[0].id).toBe(prevSession.id as string);
    expect(r2.body[0].sessions[0].id).toBe(todaySession.id as string);
  });

  it("POST /:date/sessions - 인증 없음 → 401", async () => {
    const { accessToken } = await createTestUser("dr10b");
    const logic = await createLogic(accessToken);
    const res = await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .send(makeSession(logic));
    expect(res.status).toBe(401);
  });

  // ─── PUT /:date/sessions/:sessionId ─────────────────────────────────────────

  it("PUT /:date/sessions/:sessionId - 세션 수정", async () => {
    const { accessToken } = await createTestUser("dr11");
    const logic = await createLogic(accessToken);
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic, { id: sessionId }));

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

  it("PUT /:date/sessions/:sessionId - 같은 그룹의 다른 카테고리로 변경 반영", async () => {
    const { accessToken } = await createTestUser("dr11b");
    const logic = await createLogic(accessToken);
    const sessionId = crypto.randomUUID();
    const oldCatId = logic.categories[0].id as string;
    const newCatId = logic.categories[1].id as string; // 같은 그룹(로직) 내 다른 카테고리

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic, { id: sessionId, categoryId: oldCatId }));

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
    expect(getRes.body[0].sessions[0].categoryId).toBe(newCatId);
  });

  it("PUT /:date/sessions/:sessionId - 다른 로직의 카테고리로 변경 시도 → 400 SESSION_CATEGORY_INVALID", async () => {
    const { accessToken } = await createTestUser("dr11d");
    const logicA = await createLogic(accessToken, { name: "로직A" });
    const logicB = await createLogic(accessToken, {
      name: "로직B",
      categories: [
        { name: "독서", colorVar: "--cat-color-03", targetMinutes: 30, targetPercent: 100.0 },
      ],
    });
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logicA, { id: sessionId }));

    const foreignCatId = logicB.categories[0].id as string;
    const res = await request(app)
      .put(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken))
      .send({ categoryId: foreignCatId });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SESSION_CATEGORY_INVALID");

    // DB에도 반영되지 않았는지 확인
    const getRes = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));
    expect(getRes.body[0].sessions[0].categoryId).not.toBe(foreignCatId);
  });

  it("PUT /:date/sessions/:sessionId - categoryId 미전송 시 기존 값 유지", async () => {
    const { accessToken } = await createTestUser("dr11c");
    const logic = await createLogic(accessToken);
    const sessionId = crypto.randomUUID();
    const catId = logic.categories[0].id as string;

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic, { id: sessionId, categoryId: catId }));

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
    const logic = await createLogic(u1.accessToken);
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(u1.accessToken))
      .send(makeSession(logic, { id: sessionId }));

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
    const logic = await createLogic(accessToken);
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic, { id: sessionId }));

    const res = await request(app)
      .delete(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken));
    expect(res.status).toBe(204);
  });

  it("DELETE /:date/sessions/:sessionId - 타인 세션 삭제 시도 → 404", async () => {
    const u1 = await createTestUser("dr14a");
    const u2 = await createTestUser("dr14b");
    const logic = await createLogic(u1.accessToken);
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(u1.accessToken))
      .send(makeSession(logic, { id: sessionId }));

    const res = await request(app)
      .delete(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(u2.accessToken));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SESSION_NOT_FOUND");
  });

  it("achievementCache - sessions가 없으면 null", async () => {
    // sessions이 없는 경우는 daily_record 자체가 없어 조회 결과가 빈 배열
    // → sessions 추가 후 삭제하는 시나리오로 achievementCache=null인 상태를 검증
    const { accessToken } = await createTestUser("dr15");
    const logic = await createLogic(accessToken);
    const sessionId = crypto.randomUUID();

    await request(app)
      .post("/api/v1/daily-records/2024-01-15/sessions")
      .set(authHeader(accessToken))
      .send(makeSession(logic, { id: sessionId }));

    // 세션 삭제
    await request(app)
      .delete(`/api/v1/daily-records/2024-01-15/sessions/${sessionId}`)
      .set(authHeader(accessToken));

    const res = await request(app)
      .get("/api/v1/daily-records/2024-01-15")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].achievementCache).toBeNull();
  });
});
