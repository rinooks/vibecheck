import styles from "./ScoreGauge.module.css";
import type { Grade } from "@/lib/score";

interface ScoreGaugeProps {
  score: number;
  grade: Grade;
}

const GRADE_COLOR: Record<Grade, string> = {
  우수: "#22c55e",
  양호: "#3b82f6",
  주의: "#eab308",
  위험: "#ef4444",
};

export default function ScoreGauge({ score, grade }: ScoreGaugeProps) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = GRADE_COLOR[grade];

  return (
    <div className={styles.wrap}>
      <svg viewBox="0 0 160 160" className={styles.svg}>
        <circle cx="80" cy="80" r={radius} className={styles.track} strokeWidth="14" fill="none" />
        <circle
          cx="80"
          cy="80"
          r={radius}
          stroke={color}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 80 80)"
          className={styles.progress}
        />
        <text x="80" y="74" textAnchor="middle" className={styles.scoreText}>
          {score}
        </text>
        <text x="80" y="96" textAnchor="middle" className={styles.scoreSub}>
          / 100
        </text>
      </svg>
      <span className={styles.badge} style={{ backgroundColor: color }}>
        {grade}
      </span>
    </div>
  );
}
