import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { query, closePool } from "../src/lib/db.js";
import routineRouter from "../src/modules/routine/routine.router.js";
import logicsRouter from "../src/modules/logics/logics.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { createTestUser, authHeader } from "./helpers.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/routine", routineRouter);
app.use("/api/v1/logics", logicsRouter);
app.use(errorHandler);

const TRUNCATE = `TRUNCATE study_logics, categories, routine_settings, routine_days, app_settings, users RESTART IDENTITY CASCADE`;

const emptyDays = {
  "0": { enabled: false, time: null, logicId: null },
  "1": { enabled: false, time: null, logicId: null },
  "2": { enabled: false, time: null, logicId: null },
  "3": { enabled: false, time: null, logicId: null },
  "4": { enabled: false, time: null, logicId: null },
  "5": { enabled: false, time: null, logicId: null },
  "6": { enabled: false, time: null, logicId: null },
};

beforeEach(async () => {
  await query(TRUNCATE, []);
});

afterAll(async () => {
  await closePool();
});

describe("routine API", () => {
  it("미설정 GET → 기본값(7일 enabled=false)", async () => {
    const { accessToken } = await createTestUser("r1");
    const res = await request(app).get("/api/v1/routine").set(authHeader(accessToken));
    expect(res.status).toBe(200);
    for (let i = 0; i <= 6; i++) {
      expect(res.body.days[String(i)].enabled).toBe(false);
      expect(res.body.days[String(i)].time).toBe(null);
      expect(res.body.days[String(i)].logicId).toBe(null);
    }
  });

  it("PUT 후 GET → 일치", async () => {
    const { accessToken } = await createTestUser("r2");
    const logicRes = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(accessToken))
      .send({
        name: "루틴용",
        totalTargetMinutes: 60,
        categories: [
          { name: "수학", colorVar: "--cat-color-01", targetMinutes: 60, targetPercent: 100.0 },
        ],
      });
    const logicId = logicRes.body.id;

    const putPayload = {
      days: {
        ...emptyDays,
        "0": { enabled: true, time: "08:00", logicId },
      },
    };
    const putRes = await request(app)
      .put("/api/v1/routine")
      .set(authHeader(accessToken))
      .send(putPayload);
    expect(putRes.status).toBe(200);

    const getRes = await request(app).get("/api/v1/routine").set(authHeader(accessToken));
    expect(getRes.body.days["0"].enabled).toBe(true);
    expect(getRes.body.days["0"].time).toBe("08:00");
    expect(getRes.body.days["0"].logicId).toBe(logicId);
  });

  it("타 유저 logicId → null로 저장", async () => {
    const u1 = await createTestUser("r3a");
    const u2 = await createTestUser("r3b");
    const logicRes = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(u1.accessToken))
      .send({
        name: "루틴용",
        totalTargetMinutes: 60,
        categories: [
          { name: "수학", colorVar: "--cat-color-01", targetMinutes: 60, targetPercent: 100.0 },
        ],
      });
    const foreignLogicId = logicRes.body.id;

    const putPayload = {
      days: {
        ...emptyDays,
        "0": { enabled: true, time: null, logicId: foreignLogicId },
      },
    };
    await request(app).put("/api/v1/routine").set(authHeader(u2.accessToken)).send(putPayload);
    const getRes = await request(app).get("/api/v1/routine").set(authHeader(u2.accessToken));
    expect(getRes.body.days["0"].logicId).toBe(null);
  });

  it("인증 없음 GET → 401", async () => {
    const res = await request(app).get("/api/v1/routine");
    expect(res.status).toBe(401);
  });
});
