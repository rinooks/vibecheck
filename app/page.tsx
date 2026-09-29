"use client";

import { useState } from "react";
import styles from "./page.module.css";
import ScoreGauge from "@/components/ScoreGauge";
import CheckCard from "@/components/CheckCard";
import { gradeFromScore } from "@/lib/score";
import type { Check, CheckCategory, TechInfo } from "@/lib/checks";

interface RedirectHop {
  url: string;
  status: number;
}

interface DiagnosisResult {
  inputUrl: string;
  finalUrl: string;
  statusCode: number;
  redirectChain: RedirectHop[];
  ttfbMs: number;
  score: number;
  checks: Check[];
  tech: TechInfo;
  fetchedAt: string;
}

const CATEGORY_ORDER: CheckCategory[] = ["보안", "기본 상태", "기술", "SEO"];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnosisResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "진단 중 오류가 발생했어요.");
        return;
      }

      setResult(data as DiagnosisResult);
    } catch {
      setError("서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  const grade = result ? gradeFromScore(result.score) : null;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>VibeCheck — 바이브코딩 앱 진단기</h1>
        <p className={styles.heroSubtitle}>URL만 넣으면 보안·속도·SEO를 진단해 드려요</p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          type="text"
          className={styles.input}
          placeholder="https://my-vibe-app.vercel.app"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className={styles.button} disabled={loading || !url.trim()}>
          {loading ? "진단 중..." : "진단하기"}
        </button>
      </form>

      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>사이트를 안전하게 살펴보는 중이에요. 최대 10초 정도 걸릴 수 있어요...</p>
        </div>
      )}

      {error && <div className={styles.error}>⚠️ {error}</div>}

      {result && grade && (
        <div className={styles.results}>
          <section className={styles.summary}>
            <ScoreGauge score={result.score} grade={grade} />
            <div className={styles.summaryInfo}>
              <p className={styles.summaryRow}>
                <strong>진단한 주소</strong> {result.inputUrl}
              </p>
              {result.finalUrl !== result.inputUrl && (
                <p className={styles.summaryRow}>
                  <strong>최종 도착 주소</strong> {result.finalUrl}
                </p>
              )}
              <p className={styles.summaryRow}>
                <strong>응답 상태</strong> {result.statusCode}
              </p>
              <p className={styles.summaryRow}>
                <strong>첫 응답 속도</strong> 약 {result.ttfbMs}ms
              </p>
              {result.redirectChain.length > 0 && (
                <p className={styles.summaryRow}>
                  <strong>리다이렉트</strong> {result.redirectChain.length}회
                </p>
              )}
              <p className={styles.summaryRow}>
                <strong>진단 시각</strong> {new Date(result.fetchedAt).toLocaleString("ko-KR")}
              </p>
            </div>
          </section>

          {CATEGORY_ORDER.map((category) => {
            const items = result.checks.filter((c) => c.category === category);
            if (items.length === 0) return null;
            return (
              <section key={category} className={styles.categorySection}>
                <h2 className={styles.categoryTitle}>{category}</h2>
                <div className={styles.cardGrid}>
                  {items.map((check) => (
                    <CheckCard key={check.id} check={check} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <footer className={styles.footer}>
        <p>VibeCheck는 입력하신 URL에 대해 읽기 전용으로만 정보를 확인해요. 공격적인 스캔은 하지 않아요.</p>
      </footer>
    </div>
  );
}
