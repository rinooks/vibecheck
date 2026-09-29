"use client";

import { useState } from "react";
import styles from "./ResultReport.module.css";
import ScoreGauge from "./ScoreGauge";
import CheckCard from "./CheckCard";
import { gradeFromScore, type Tone } from "@/lib/score";
import type { Check, CheckCategory, CheckStatus } from "@/lib/checks";
import type { DiagnosisResult } from "@/lib/history";

const CATEGORY_ORDER: CheckCategory[] = ["보안", "기본 상태", "기술", "SEO"];
const STATUS_RANK: Record<CheckStatus, number> = { danger: 0, warning: 1, pass: 2 };

interface Counts {
  danger: number;
  warning: number;
  pass: number;
}

function countStatuses(checks: Check[]): Counts {
  const counts: Counts = { danger: 0, warning: 0, pass: 0 };
  for (const c of checks) counts[c.status]++;
  return counts;
}

function toneOf(counts: Counts): Tone {
  if (counts.danger > 0) return "danger";
  if (counts.warning > 0) return "caution";
  return "excellent";
}

function CountsLine({ counts }: { counts: Counts }) {
  return (
    <span className={styles.countsLine}>
      <span data-tone="danger">위험 {counts.danger}</span>
      <span className={styles.dot}>·</span>
      <span data-tone="caution">주의 {counts.warning}</span>
      <span className={styles.dot}>·</span>
      <span data-tone="excellent">통과 {counts.pass}</span>
    </span>
  );
}

export default function ResultReport({ result }: { result: DiagnosisResult }) {
  const grade = gradeFromScore(result.score);
  const groups = CATEGORY_ORDER.map((category) => {
    const items = result.checks
      .filter((c) => c.category === category)
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
    return { category, items, counts: countStatuses(items) };
  }).filter((g) => g.items.length > 0);
  const total = countStatuses(result.checks);

  // 처음엔 가장 급한 카테고리를 연다
  const [active, setActive] = useState<CheckCategory>(
    () =>
      groups.find((g) => g.counts.danger > 0)?.category ??
      groups.find((g) => g.counts.warning > 0)?.category ??
      groups[0]?.category ??
      "보안"
  );
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");

  async function handleShare() {
    const link = `${location.origin}${location.pathname}?url=${encodeURIComponent(result.inputUrl)}`;
    try {
      await navigator.clipboard.writeText(link);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2500);
    } catch {
      window.prompt("아래 링크를 복사해서 공유하세요.", link);
    }
  }

  const activeGroup = groups.find((g) => g.category === active) ?? groups[0];

  return (
    <div className={styles.report}>
      <section className={styles.summary}>
        <div className={styles.summaryHead}>
          <span className={styles.reportLabel}>웹사이트 건강검진 결과</span>
          <span className={styles.reportDate}>{new Date(result.fetchedAt).toLocaleString("ko-KR")}</span>
        </div>

        <div className={styles.summaryBody}>
          <ScoreGauge score={result.score} grade={grade} />

          <div className={styles.summaryInfo}>
            <p className={styles.siteUrl}>{result.inputUrl}</p>

            <div className={styles.statTiles}>
              <div className={styles.statTile} data-tone="danger">
                <span className={styles.statNum}>{total.danger}</span>
                <span className={styles.statLabel}>위험</span>
              </div>
              <div className={styles.statTile} data-tone="caution">
                <span className={styles.statNum}>{total.warning}</span>
                <span className={styles.statLabel}>주의</span>
              </div>
              <div className={styles.statTile} data-tone="excellent">
                <span className={styles.statNum}>{total.pass}</span>
                <span className={styles.statLabel}>통과</span>
              </div>
            </div>

            <dl className={styles.metaList}>
              {result.finalUrl !== result.inputUrl && (
                <div>
                  <dt>최종 도착 주소</dt>
                  <dd>{result.finalUrl}</dd>
                </div>
              )}
              <div>
                <dt>응답 상태</dt>
                <dd>{result.statusCode}</dd>
              </div>
              <div>
                <dt>첫 응답 속도</dt>
                <dd>약 {result.ttfbMs}ms</dd>
              </div>
              {result.redirectChain.length > 0 && (
                <div>
                  <dt>리다이렉트</dt>
                  <dd>{result.redirectChain.length}회</dd>
                </div>
              )}
            </dl>

            <button type="button" className={styles.shareButton} onClick={handleShare}>
              {shareState === "copied" ? "링크를 복사했어요 ✓" : "공유 링크 복사"}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.categories}>
        <div className={styles.tabs} role="tablist" aria-label="진단 카테고리">
          {groups.map((g, i) => (
            <button
              key={g.category}
              type="button"
              role="tab"
              id={`category-tab-${i}`}
              aria-selected={g.category === activeGroup?.category}
              aria-controls="category-panel"
              className={styles.tab}
              data-tone={toneOf(g.counts)}
              onClick={() => setActive(g.category)}
            >
              <span className={styles.tabName}>
                <span className={styles.tabDot} />
                {g.category}
              </span>
              <span className={styles.tabCount}>
                {g.counts.danger + g.counts.warning > 0 ? `문제 ${g.counts.danger + g.counts.warning}` : "모두 통과"}
              </span>
            </button>
          ))}
        </div>

        {activeGroup && (
          <div
            id="category-panel"
            role="tabpanel"
            aria-labelledby={`category-tab-${groups.indexOf(activeGroup)}`}
            className={styles.panel}
          >
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{activeGroup.category}</h2>
              <CountsLine counts={activeGroup.counts} />
            </div>
            <div className={styles.cardList}>
              {activeGroup.items.map((check) => (
                <CheckCard key={check.id} check={check} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
