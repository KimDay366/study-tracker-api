import { describe, it, expect } from "vitest";
import request from "supertest";

// 테스트에서 서버를 직접 listen하지 않도록 app만 import
// app.ts가 listen을 포함하므로 테스트용으로 express 앱만 분리해서 가져옴
import express from "express";
import cors from "cors";
import healthRouter from "../src/modules/health/health.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";

const testApp = express();
testApp.use(express.json());
testApp.use(cors());
testApp.use("/health", healthRouter);
testApp.use(errorHandler);

describe("GET /health", () => {
  it("200 ok 응답을 반환한다", async () => {
    const res = await request(testApp).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("study-tracker-api");
    expect(typeof res.body.timestamp).toBe("string");
  });
});
