/**
 * pg DATE 컬럼을 로컬 기준 YYYY-MM-DD 문자열로 변환.
 *
 * toISOString()은 UTC 기준이므로 UTC+9(한국)에서 하루 밀리는 버그가 있음.
 * → getFullYear/getMonth/getDate 로컬 메서드를 사용.
 */
export function formatLocalDate(val: Date | string): string {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

/**
 * YYYY-MM-DD 형식이면서 실제로 존재하는 날짜인지 검사.
 *
 * 정규식만으로는 2026-13-99 같은 값을 통과시키므로,
 * Date 파싱 후 원래 문자열과 재비교해 캘린더 유효성을 확인한다.
 */
export function isValidCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // month는 0-indexed이므로 m - 1
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
