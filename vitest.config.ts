import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    // 공유 DB를 사용하므로 테스트 파일 간 병렬 실행 비활성화
    fileParallelism: false,
  },
});
