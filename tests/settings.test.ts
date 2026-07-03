import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { query, closePool } from "../src/lib/db.js";
import settingsRouter from "../src/modules/settings/settings.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { createTestUser, authHeader } from "./helpers.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/settings", settingsRouter);
app.use(errorHandler);

const TRUNCATE = `TRUNCATE study_logics, categories, routine_settings, routine_days, app_settings, users RESTART IDENTITY CASCADE`;

beforeEach(async () => {
  await query(TRUNCATE, []);
});

afterAll(async () => {
  await closePool();
});

describe("settings API", () => {
  it("미설정 GET → 기본값", async () => {
    const { accessToken } = await createTestUser("s1");
    const res = await request(app).get("/api/v1/settings").set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.autoStartOnCategorySelect).toBe(false);
    expect(res.body.lastUsedLogicId).toBe(null);
    expect(res.body.dataFormatVersion).toBe("1.0.0");
    expect(res.body.firstLaunchDate).toBe(null);
    expect(res.body.hasSeenOnboarding).toBe(false);
  });

  it("PATCH 부분수정 → 반영됨", async () => {
    const { accessToken } = await createTestUser("s2");
    const res = await request(app)
      .patch("/api/v1/settings")
      .set(authHeader(accessToken))
      .send({
        autoStartOnCategorySelect: true,
        hasSeenOnboarding: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.autoStartOnCategorySelect).toBe(true);
    expect(res.body.hasSeenOnboarding).toBe(true);
    expect(res.body.dataFormatVersion).toBe("1.0.0");
  });

  it("dataFormatVersion PATCH → 400", async () => {
    const { accessToken } = await createTestUser("s3");
    const res = await request(app)
      .patch("/api/v1/settings")
      .set(authHeader(accessToken))
      .send({
        dataFormatVersion: "2.0.0",
      });
    expect(res.status).toBe(400);
  });

  it("firstLaunchDate PATCH → YYYY-MM-DD 형식 반환", async () => {
    const { accessToken } = await createTestUser("s4");
    const res = await request(app)
      .patch("/api/v1/settings")
      .set(authHeader(accessToken))
      .send({ firstLaunchDate: "2026-06-22" });
    expect(res.status).toBe(200);
    // pg DATE 컬럼이 UTC 변환 없이 로컬 기준으로 YYYY-MM-DD를 유지해야 함
    expect(res.body.firstLaunchDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.firstLaunchDate).toBe("2026-06-22");
  });

  it("인증 없음 GET → 401", async () => {
    const res = await request(app).get("/api/v1/settings");
    expect(res.status).toBe(401);
  });

  it("dataFormatVersion - DB row가 없을 때 lazy insert 후 반환값이 '1.0.0'", async () => {
    // DB에 '1'이 아닌 '1.0.0'으로 저장·반환되는지 확인 (마이그레이션 검증)
    const { accessToken, email } = await createTestUser("s5");
    const res = await request(app).get("/api/v1/settings").set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.dataFormatVersion).toBe("1.0.0");
    // DB에도 '1.0.0'으로 저장되어 있어야 함
    const dbRes = await query<{ data_format_version: string }>(
      `SELECT data_format_version FROM app_settings
       WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    expect(dbRes.rows[0]?.data_format_version).toBe("1.0.0");
  });
});
