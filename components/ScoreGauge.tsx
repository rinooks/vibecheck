"use client";

import { useEffect, useState } from "react";
import styles from "./ScoreGauge.module.css";
import { GRADE_TONE, type Grade } from "@/lib/score";

interface ScoreGaugeProps {
  score: number;
  grade: Grade;
}

const RADIUS = 84;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// 아래쪽 90°를 비운 270° 계기판 모양
const ARC = CIRCUMFERENCE * 0.75;
const DURATION_MS = 1100;

export default function ScoreGauge({ score, grade }: ScoreGaugeProps) {
  const target = Math.max(0, Math.min(100, score));
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = reduceMotion ? 1 : Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <div className={styles.wrap} data-tone={GRADE_TONE[grade]}>
      <svg viewBox="0 0 200 200" className={styles.svg} role="img" aria-label={`100점 만점에 ${score}점, ${grade}`}>
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          className={styles.track}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${ARC} ${CIRCUMFERENCE}`}
          transform="rotate(135 100 100)"
        />
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          className={styles.progress}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(ARC * progress) / 100} ${CIRCUMFERENCE}`}
          transform="rotate(135 100 100)"
        />
        <text x="100" y="104" textAnchor="middle" className={styles.scoreText}>
          {Math.round(progress)}
        </text>
        <text x="100" y="130" textAnchor="middle" className={styles.scoreSub}>
          / 100점
        </text>
      </svg>
      <span className={styles.badge}>{grade}</span>
    </div>
  );
}
