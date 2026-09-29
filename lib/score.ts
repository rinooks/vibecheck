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

// 등급·상태별 색상 톤. globals.css의 [data-tone] 규칙과 짝을 이룬다.
export type Tone = "excellent" | "good" | "caution" | "danger";

export const GRADE_TONE: Record<Grade, Tone> = {
  우수: "excellent",
  양호: "good",
  주의: "caution",
  위험: "danger",
};

export const STATUS_TONE: Record<Check["status"], Tone> = {
  pass: "excellent",
  warning: "caution",
  danger: "danger",
};
