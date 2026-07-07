import argon2 from "argon2";

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id });

export const verifyPassword = (hash: string, password: string): Promise<boolean> =>
  argon2.verify(hash, password);

/**
 * 계정이 없거나(존재하지 않는 이메일) 비밀번호가 없는 계정(OAuth 전용)에서도
 * 항상 argon2.verify를 실행해 응답시간을 상수화하기 위한 더미 해시.
 * 실제 프로덕션 해시와 동일한 파라미터(argon2id, m=65536,t=3,p=4)로 생성했으며,
 * 이 해시로는 어떤 실제 사용자 비밀번호도 검증에 통과할 수 없다(무작위 더미 원문 기반).
 *
 * Why: 로그인 응답시간이 "계정 존재 여부"에 따라 달라지면(더미 verify 생략 시
 * 즉시 반환 vs argon2 실행 지연) 타이밍만으로 계정 존재를 유추하는 사이드채널이 된다.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$3pyx1NqpJuhRVeSc+tSlUA$pC+MBSjZpmyN/KSa7mmpeX3Qbpa8BXMfkf6qFdnHpGM";
