# study-tracker-api

**Study Tracker** 서비스의 백엔드 REST API 서버입니다.
공부 시간 기록·루틴 관리·일일/주간 회고를 지원하는 스터디 트래커의 서버 사이드를 담당합니다.

## 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| 런타임/언어 | Node.js + TypeScript (ESM) |
| 웹 프레임워크 | Express 4 |
| 데이터베이스 | PostgreSQL 16 (로컬) / Supabase (배포) |
| 마이그레이션 | node-pg-migrate |
| 입력 검증 | zod |
| 인증 | JWT (jsonwebtoken) + argon2 (비밀번호 해시) + 쿠키 기반 리프레시 |
| 이메일 | Resend (이메일 인증·비밀번호 재설정) |
| 소셜 로그인 | Google OAuth 2.0 |
| 테스트 | vitest + supertest |

## 요구 사항

- Node.js 18 이상
- PostgreSQL 16 (로컬 개발용) — 배포 시 Supabase로 교체

## 설치 및 실행

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정 (아래 '환경변수' 표 참고)
cp .env.example .env

# 3. DB 마이그레이션 (테이블 생성)
npm run migrate:up

# 4. 개발 서버 실행 (http://localhost:4000)
npm run dev

# 5. 프로덕션 빌드 & 실행
npm run build
npm start

# 6. 테스트
npm test
```

## 환경변수

`.env.example` 참고. **`.env`에는 실제 비밀값이 들어가므로 절대 커밋하지 마세요.**

| 키 | 설명 | 로컬 개발 |
|----|------|-----------|
| `NODE_ENV` | 실행 환경 | 필수 |
| `PORT` | 서버 포트 (기본 4000) | 필수 |
| `CLIENT_ORIGIN` | CORS 허용 프론트 주소 | 필수 |
| `DATABASE_URL` | PostgreSQL 연결 문자열 | 필수 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 토큰 서명 시크릿 | 필수 |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | 토큰 만료 시간 | 필수 |
| `SUPABASE_*` | Supabase 연결 (배포용) | 선택 (비워도 부팅) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | 이메일 발송 | 선택 (비우면 발송 비활성) |
| `GOOGLE_OAUTH_*` | 구글 소셜 로그인 | 선택 (비우면 비활성) |

> 로컬 개발에서는 Supabase·Resend·Google 키가 비어 있어도 서버가 기동됩니다. (해당 기능만 비활성)

## API 엔드포인트

베이스 경로: `/api/v1`

| 그룹 | 경로 | 설명 |
|------|------|------|
| Health | `GET /health` | 서버 상태 확인 |
| 인증 | `/api/v1/auth` | 회원가입·로그인·토큰 갱신·로그아웃·이메일 인증·구글 로그인 |
| 학습 로직 | `/api/v1/logics` | 학습 로직(과목/항목) CRUD |
| 루틴 | `/api/v1/routine` | 학습 루틴 관리 |
| 설정 | `/api/v1/settings` | 사용자 설정 |
| 일일 기록 | `/api/v1/daily-records` | 날짜별 학습 기록 |
| 주간 회고 | `/api/v1/weekly-reviews` | 주간 회고 기록 |

### 인증(`/api/v1/auth`) 상세

| Method | Path | 설명 |
|--------|------|------|
| POST | `/signup` | 회원가입 |
| POST | `/login` | 로그인 |
| POST | `/refresh` | 액세스 토큰 갱신 |
| POST | `/logout` | 로그아웃 |
| POST | `/verify-email` | 이메일 인증 |

## 프로젝트 구조

```
src/
├── modules/          # 기능별 독립 모듈 (라우터/컨트롤러/서비스/레포/타입)
│   ├── auth/         # 인증
│   ├── health/       # 헬스체크
│   ├── logics/       # 학습 로직
│   ├── routine/      # 루틴
│   ├── settings/     # 설정
│   ├── daily-records/    # 일일 기록
│   └── weekly-reviews/   # 주간 회고
├── lib/              # 공통 라이브러리 (env 등)
├── middlewares/      # 미들웨어 (검증/에러핸들러/asyncHandler)
└── app.ts            # 진입점
migrations/           # DB 마이그레이션 (node-pg-migrate)
tests/                # 통합 테스트 (vitest + supertest)
```
