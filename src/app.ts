import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./lib/env.js";
import healthRouter from "./modules/health/health.router.js";
import authRouter from "./modules/auth/auth.router.js";
import logicsRouter from "./modules/logics/logics.router.js";
import routineRouter from "./modules/routine/routine.router.js";
import settingsRouter from "./modules/settings/settings.router.js";
import dailyRecordsRouter from "./modules/daily-records/daily-records.router.js";
import weeklyReviewsRouter from "./modules/weekly-reviews/weekly-reviews.router.js";
import { errorHandler } from "./middlewares/errorHandler.js";

const app = express();

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/health", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/logics", logicsRouter);
app.use("/api/v1/routine", routineRouter);
app.use("/api/v1/settings", settingsRouter);
app.use("/api/v1/daily-records", dailyRecordsRouter);
app.use("/api/v1/weekly-reviews", weeklyReviewsRouter);

app.use(errorHandler);

const PORT = env.PORT;
app.listen(PORT, () => {
  console.info(`[server] study-tracker-api running on port ${PORT}`);
});

export default app;
