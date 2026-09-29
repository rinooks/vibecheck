"use client";

import { useId, useState } from "react";
import styles from "./CheckCard.module.css";
import type { Check } from "@/lib/checks";
import { STATUS_TONE } from "@/lib/score";

const STATUS_LABEL: Record<Check["status"], string> = {
  pass: "통과",
  warning: "주의",
  danger: "위험",
};

export default function CheckCard({ check }: { check: Check }) {
  // 문제 있는 항목은 펼쳐서, 통과 항목은 접어서 보여준다.
  const [open, setOpen] = useState(check.status !== "pass");
  const [copied, setCopied] = useState(false);
  const bodyId = useId();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(check.aiPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 접근이 막혀 있으면 직접 복사할 수 있게 띄워준다
      window.prompt("아래 내용을 복사해서 AI에게 붙여넣으세요.", check.aiPrompt);
    }
  }

  return (
    <article className={styles.card} data-tone={STATUS_TONE[check.status]}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <span className={styles.statusBadge}>{STATUS_LABEL[check.status]}</span>
        <span className={styles.headText}>
          <span className={styles.title}>{check.title}</span>
          <span className={styles.details}>{check.details}</span>
        </span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div id={bodyId} className={styles.body}>
          <div className={styles.section}>
            <p className={styles.sectionLabel}>이게 왜 문제예요?</p>
            <p className={styles.sectionBody}>{check.why}</p>
          </div>

          <div className={styles.section}>
            <p className={styles.sectionLabel}>이렇게 고치세요</p>
            <p className={styles.sectionBody}>{check.howToFix}</p>
          </div>

          {check.status !== "pass" && check.aiPrompt && (
            <div className={`${styles.section} ${styles.promptSection}`}>
              <div className={styles.promptHead}>
                <p className={styles.sectionLabel}>AI에게 이렇게 물어보세요</p>
                <button type="button" className={styles.copyButton} onClick={handleCopy}>
                  {copied ? "복사됨 ✓" : "복사"}
                </button>
              </div>
              <p className={styles.promptText}>{check.aiPrompt}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
