import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { query, closePool } from "../src/lib/db.js";
import weeklyReviewsRouter from "../src/modules/weekly-reviews/weekly-reviews.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { createTestUser, authHeader } from "./helpers.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/weekly-reviews", weeklyReviewsRouter);
app.use(errorHandler);

const TRUNCATE = `TRUNCATE study_logics, categories, routine_settings, routine_days,
  app_settings, daily_records, sessions, logic_snapshots, snapshot_categories,
  weekly_reviews, users RESTART IDENTITY CASCADE`;

const sampleReview = {
  keep: "매일 꾸준히 공부함",
  problem: "집중력 분산",
  try: "포모도로 기법 적용",
  pledge: "매일 최소 2시간",
  usedBuiltinQuote: false,
  builtinQuoteIndex: null,
};

beforeEach(async () => {
  await query(TRUNCATE, []);
});

afterAll(async () => {
  await closePool();
});

describe("weekly-reviews API", () => {
  it("GET /:weekStartDate - 없으면 404 WEEKLY_REVIEW_NOT_FOUND", async () => {
    const { accessToken } = await createTestUser("wr1");
    const res = await request(app)
      .get("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(accessToken));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("WEEKLY_REVIEW_NOT_FOUND");
  });

  it("PUT /:weekStartDate - upsert (신규 생성)", async () => {
    const { accessToken } = await createTestUser("wr2");
    const res = await request(app)
      .put("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(accessToken))
      .send(sampleReview);

    expect(res.status).toBe(200);
    expect(res.body.weekStartDate).toBe("2024-01-14");
    expect(res.body.keep).toBe(sampleReview.keep);
    expect(res.body.problem).toBe(sampleReview.problem);
    expect(res.body.usedBuiltinQuote).toBe(false);
    expect(res.body.builtinQuoteIndex).toBeNull();
    expect(res.body.createdAt).toBeTruthy();
    expect(res.body.updatedAt).toBeTruthy();
  });

  it("PUT /:weekStartDate - upsert (수정)", async () => {
    const { accessToken } = await createTestUser("wr3");

    await request(app)
      .put("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(accessToken))
      .send(sampleReview);

    const updated = { ...sampleReview, keep: "수정된 내용", usedBuiltinQuote: true, builtinQuoteIndex: 3 };
    const res = await request(app)
      .put("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(accessToken))
      .send(updated);

    expect(res.status).toBe(200);
    expect(res.body.keep).toBe("수정된 내용");
    expect(res.body.usedBuiltinQuote).toBe(true);
    expect(res.body.builtinQuoteIndex).toBe(3);
  });

  it("GET /:weekStartDate - PUT 후 조회", async () => {
    const { accessToken } = await createTestUser("wr4");

    await request(app)
      .put("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(accessToken))
      .send(sampleReview);

    const res = await request(app)
      .get("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.weekStartDate).toBe("2024-01-14");
    expect(res.body.keep).toBe(sampleReview.keep);
  });

  it("타인 주간 회고 조회 → 404", async () => {
    const u1 = await createTestUser("wr5a");
    const u2 = await createTestUser("wr5b");

    await request(app)
      .put("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(u1.accessToken))
      .send(sampleReview);

    const res = await request(app)
      .get("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(u2.accessToken));
    expect(res.status).toBe(404);
  });

  it("PUT - 필수 필드 누락 → 400 VALIDATION_ERROR", async () => {
    const { accessToken } = await createTestUser("wr6");
    const res = await request(app)
      .put("/api/v1/weekly-reviews/2024-01-14")
      .set(authHeader(accessToken))
      .send({ keep: "내용만" }); // problem, try, pledge, usedBuiltinQuote 누락
    expect(res.status).toBe(400);
  });

  it("인증 없음 GET → 401", async () => {
    const res = await request(app).get("/api/v1/weekly-reviews/2024-01-14");
    expect(res.status).toBe(401);
  });

  it("인증 없음 PUT → 401", async () => {
    const res = await request(app)
      .put("/api/v1/weekly-reviews/2024-01-14")
      .send(sampleReview);
    expect(res.status).toBe(401);
  });

  it("GET - 형식은 맞지만 실존하지 않는 날짜(2026-13-99) → 400 INVALID_DATE_FORMAT", async () => {
    const { accessToken } = await createTestUser("wr7");
    const res = await request(app)
      .get("/api/v1/weekly-reviews/2026-13-99")
      .set(authHeader(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_FORMAT");
  });

  it("PUT - 형식은 맞지만 실존하지 않는 날짜(2026-00-01) → 400 INVALID_DATE_FORMAT", async () => {
    const { accessToken } = await createTestUser("wr8");
    const res = await request(app)
      .put("/api/v1/weekly-reviews/2026-00-01")
      .set(authHeader(accessToken))
      .send(sampleReview);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_FORMAT");
  });
});
