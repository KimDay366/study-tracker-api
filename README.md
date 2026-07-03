# study-tracker-api

Study Tracker 서비스의 백엔드 REST API 서버입니다.

## 기술 스택

- Node.js + TypeScript (ESM)
- Express
- zod (입력 검증)
- vitest + supertest (테스트)
- Supabase (S1 연결 예정), Resend (S1 이메일 예정), JWT (S1 인증 예정)

## 실행 방법

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정 (S0: 비워도 부팅 가능)
cp .env.example .env

# 3. 개발 서버 실행
npm run dev

# 4. 빌드
npm run build

# 5. 프로덕션 실행
npm start

# 6. 테스트
npm test
```

## 환경변수

`.env.example` 참고. S0 단계에서는 `NODE_ENV`, `PORT`, `CLIENT_ORIGIN`만 있으면 서버가 기동됩니다.
나머지 키(Supabase, JWT, Resend 등)는 S1(인증 구현) 단계에서 필수화됩니다.

## 엔드포인트

| Method | Path      | 설명         |
|--------|-----------|--------------|
| GET    | /health   | 서버 상태 확인 |

S1에서 추가 예정: `/api/v1/auth/*`, `/api/v1/users/*`

