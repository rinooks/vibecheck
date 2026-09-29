import type { Check } from "./checks";

export type Grade = "우수" | "양호" | "주의" | "위험";

// 경미한 항목: warning이어도 감점을 적게 한다.
const MINOR_WARNING_IDS = new Set(["permissions-policy", "generator", "html-lang"]);

export function calculateScore(checks: Check[]): number {
  let score = 100;

  for (const check of checks) {
    if (check.status === "danger") {
      score -= 10;
    } else if (check.status === "warning") {
      score -= MINOR_WARNING_IDS.has(check.id) ? 2 : 3;
    }
  }

  return Math.max(0, score);
}

export function gradeFromScore(score: number): Grade {
  if (score >= 90) return "우수";
  if (score >= 70) return "양호";
  if (score >= 50) return "주의";
  return "위험";
}
