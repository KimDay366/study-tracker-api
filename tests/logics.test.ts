import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { query, closePool } from "../src/lib/db.js";
import logicsRouter from "../src/modules/logics/logics.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { createTestUser, authHeader } from "./helpers.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/logics", logicsRouter);
app.use(errorHandler);

const TRUNCATE = `TRUNCATE study_logics, categories, routine_settings, routine_days, app_settings, users RESTART IDENTITY CASCADE`;

const sampleLogic = {
  name: "집중 루틴",
  totalTargetMinutes: 120,
  categories: [
    { name: "수학", colorVar: "--cat-color-01", targetMinutes: 60, targetPercent: 50.0 },
    { name: "영어", colorVar: "--cat-color-02", targetMinutes: 60, targetPercent: 50.0 },
  ],
};

beforeEach(async () => {
  await query(TRUNCATE, []);
});

afterAll(async () => {
  await closePool();
});

describe("logics API", () => {
  it("POST /logics → 201 + LogicResponse", async () => {
    const { accessToken } = await createTestUser("a1");
    const res = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(accessToken))
      .send(sampleLogic);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("집중 루틴");
    expect(res.body.categories.length).toBe(2);
    expect(res.body.categories[0].id).toBeTruthy();
  });

  it("GET /logics → 본인 것만", async () => {
    const u1 = await createTestUser("b1");
    const u2 = await createTestUser("b2");
    await request(app).post("/api/v1/logics").set(authHeader(u1.accessToken)).send(sampleLogic);
    await request(app)
      .post("/api/v1/logics")
      .set(authHeader(u2.accessToken))
      .send({ ...sampleLogic, name: "타인" });
    const res = await request(app).get("/api/v1/logics").set(authHeader(u1.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe("집중 루틴");
  });

  it("GET /logics/:id → 200", async () => {
    const { accessToken } = await createTestUser("c1");
    const created = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(accessToken))
      .send(sampleLogic);
    const res = await request(app)
      .get(`/api/v1/logics/${created.body.id}`)
      .set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("6번째 POST → 409 LOGIC_LIMIT_EXCEEDED", async () => {
    const { accessToken } = await createTestUser("d1");
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/v1/logics")
        .set(authHeader(accessToken))
        .send({ ...sampleLogic, name: `루틴${i}` });
    }
    const res = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(accessToken))
      .send(sampleLogic);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LOGIC_LIMIT_EXCEEDED");
  });

  it("categories 11개 → 400 VALIDATION_ERROR", async () => {
    const { accessToken } = await createTestUser("e1");
    const cats = Array.from({ length: 11 }, (_, i) => ({
      name: `카테${i}`,
      colorVar: "--cat-color-01",
      targetMinutes: 10,
      targetPercent: 9.0,
    }));
    const res = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(accessToken))
      .send({ ...sampleLogic, categories: cats });
    expect(res.status).toBe(400);
  });

  it("타인 GET /:id → 404", async () => {
    const u1 = await createTestUser("f1");
    const u2 = await createTestUser("f2");
    const created = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(u1.accessToken))
      .send(sampleLogic);
    const res = await request(app)
      .get(`/api/v1/logics/${created.body.id}`)
      .set(authHeader(u2.accessToken));
    expect(res.status).toBe(404);
  });

  it("타인 PUT /:id → 404", async () => {
    const u1 = await createTestUser("g1");
    const u2 = await createTestUser("g2");
    const created = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(u1.accessToken))
      .send(sampleLogic);
    const res = await request(app)
      .put(`/api/v1/logics/${created.body.id}`)
      .set(authHeader(u2.accessToken))
      .send({
        ...sampleLogic,
        categories: sampleLogic.categories.map((c, i) => ({
          ...c,
          id: created.body.categories[i]?.id,
        })),
      });
    expect(res.status).toBe(404);
  });

  it("타인 DELETE /:id → 404", async () => {
    const u1 = await createTestUser("h1");
    const u2 = await createTestUser("h2");
    const created = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(u1.accessToken))
      .send(sampleLogic);
    const res = await request(app)
      .delete(`/api/v1/logics/${created.body.id}`)
      .set(authHeader(u2.accessToken));
    expect(res.status).toBe(404);
  });

  it("PUT 카테고리 동기화 → 결과 2개", async () => {
    const { accessToken } = await createTestUser("i1");
    const created = await request(app)
      .post("/api/v1/logics")
      .set(authHeader(accessToken))
      .send(sampleLogic);
    const { id, categories } = created.body;
    const updatePayload = {
      name: "수정된 루틴",
      totalTargetMinutes: 180,
      categories: [
        {
          id: categories[0].id,
          name: "수학(수정)",
          colorVar: "--cat-color-03",
          targetMinutes: 90,
          targetPercent: 50.0,
        },
        {
          name: "과학(신규)",
          colorVar: "--cat-color-04",
          targetMinutes: 90,
          targetPercent: 50.0,
        },
        // categories[1]은 삭제됨
      ],
    };
    const res = await request(app)
      .put(`/api/v1/logics/${id}`)
      .set(authHeader(accessToken))
      .send(updatePayload);
    expect(res.status).toBe(200);
    expect(res.body.categories.length).toBe(2);
    expect(res.body.categories[0].name).toBe("수학(수정)");
    expect(res.body.categories[1].name).toBe("과학(신규)");
  });

  it("인증 없음 GET → 401", async () => {
    const res = await request(app).get("/api/v1/logics");
    expect(res.status).toBe(401);
  });
});
