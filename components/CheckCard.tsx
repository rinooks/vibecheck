"use client";

import { useState } from "react";
import styles from "./CheckCard.module.css";
import type { Check } from "@/lib/checks";

const STATUS_LABEL: Record<Check["status"], string> = {
  pass: "통과",
  warning: "주의",
  danger: "위험",
};

export default function CheckCard({ check }: { check: Check }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(check.aiPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 접근이 막혀 있으면 조용히 무시
    }
  }

  return (
    <div className={`${styles.card} ${styles[check.status]}`}>
      <div className={styles.header}>
        <span className={`${styles.statusBadge} ${styles[`badge-${check.status}`]}`}>{STATUS_LABEL[check.status]}</span>
        <h3 className={styles.title}>{check.title}</h3>
      </div>

      <p className={styles.details}>{check.details}</p>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>이게 왜 문제예요?</p>
        <p className={styles.sectionBody}>{check.why}</p>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>이렇게 고치세요</p>
        <p className={styles.sectionBody}>{check.howToFix}</p>
      </div>

      {check.status !== "pass" && check.aiPrompt && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>AI에게 이렇게 물어보세요</p>
          <div className={styles.promptBox}>
            <p className={styles.promptText}>{check.aiPrompt}</p>
            <button type="button" className={styles.copyButton} onClick={handleCopy}>
              {copied ? "복사됨!" : "복사"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
