/**
 * Supabase 클라이언트 placeholder.
 * S1에서 실제 연결 로직으로 교체 예정.
 * 환경변수가 없으면 null 반환 — 사용처에서 null 체크 필수.
 */
import { env } from "./env.js";

// S1: createClient import 및 실제 초기화로 교체
// import { createClient } from "@supabase/supabase-js";

let _supabase: null = null;

if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
  // S1: _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  console.info("[supabase] placeholder — S1에서 실제 클라이언트로 교체 예정");
} else {
  console.warn("[supabase] SUPABASE_URL / SUPABASE_ANON_KEY 미설정 — 클라이언트 미초기화");
}

export const supabase = _supabase;
