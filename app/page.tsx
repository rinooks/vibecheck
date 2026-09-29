"use client";

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";
import ResultReport from "@/components/ResultReport";
import { GRADE_TONE, gradeFromScore } from "@/lib/score";
import {
  addHistoryEntry,
  clearHistory,
  formatKoreanDate,
  getHistoryServerSnapshot,
  getHistorySnapshot,
  normalizeHistoryUrl,
  subscribeHistory,
  type DiagnosisResult,
  type HistoryEntry,
} from "@/lib/history";

const PREVIEW_ITEMS = [
  "HTTPS · SSL 인증서",
  "보안 헤더 6종",
  ".env · .git 노출",
  "소스맵 노출",
  "쿠키 보안",
  "CORS 설정",
  "에러 페이지 정보 노출",
  "응답 속도",
  "한글 인코딩",
  "검색 노출(SEO)",
  "모바일 화면",
];

interface ResultView {
  result: DiagnosisResult;
  /** 새로 진단한 결과면 직전 기록, 과거 기록 보기면 undefined */
  previous?: HistoryEntry | null;
  /** 과거 기록을 다시 보는 중이면 그 기록의 저장 시각 */
  savedAt?: string;
}

/** ?url= 쿼리를 읽어 자동 진단을 요청한다. useSearchParams 때문에 Suspense 안에서만 렌더링. */
function SharedUrlWatcher({ onUrl }: { onUrl: (url: string) => void }) {
  const sharedUrl = useSearchParams().get("url");
  useEffect(() => {
    if (sharedUrl) onUrl(sharedUrl);
  }, [sharedUrl, onUrl]);
  return null;
}

function ComparisonBanner({ current, previous }: { current: number; previous: HistoryEntry }) {
  const diff = current - previous.score;
  if (diff > 0) {
    return (
      <div className={styles.banner} data-tone="excellent">
        <strong>▲</strong> 지난번({formatKoreanDate(previous.date)})보다 +{diff}점 올랐어요
      </div>
    );
  }
  if (diff < 0) {
    return (
      <div className={styles.banner} data-tone="danger">
        <strong>▼</strong> 지난번보다 {diff}점 떨어졌어요
      </div>
    );
  }
  return (
    <div className={styles.banner} data-tone="good">
      <strong>＝</strong> 지난번과 같은 점수예요
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ResultView | null>(null);
  const history = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistoryServerSnapshot);

  const requestIdRef = useRef(0);
  const lastSharedUrlRef = useRef<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const runDiagnosis = useCallback(async (rawUrl: string) => {
    const target = rawUrl.trim();
    if (!target) return;
    const requestId = ++requestIdRef.current;

    setUrl(target);
    setLoading(true);
    setError(null);
    setView(null);

    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();
      if (requestId !== requestIdRef.current) return; // 더 최근 요청이 있으면 무시

      if (!res.ok) {
        setError(data?.error || "진단 중 오류가 발생했어요.");
        return;
      }

      const result = data as DiagnosisResult;
      const previous = addHistoryEntry({
        url: normalizeHistoryUrl(result.inputUrl),
        date: result.fetchedAt,
        score: result.score,
        grade: gradeFromScore(result.score),
        result,
      });
      setView({ result, previous });
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError("서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const handleSharedUrl = useCallback(
    (shared: string) => {
      // StrictMode 이중 실행 등으로 같은 링크를 두 번 진단하지 않도록
      if (lastSharedUrlRef.current === shared) return;
      lastSharedUrlRef.current = shared;
      runDiagnosis(shared);
    },
    [runDiagnosis]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    runDiagnosis(url);
  }

  function openHistory(entry: HistoryEntry) {
    requestIdRef.current++; // 진행 중인 진단 결과가 기록 화면을 덮어쓰지 않게
    setLoading(false);
    setError(null);
    setUrl(entry.result.inputUrl);
    setView({ result: entry.result, savedAt: entry.date });
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function handleClearHistory() {
    if (window.confirm("진단 기록을 모두 지울까요?")) clearHistory();
  }

  const compact = loading || !!view || !!error;

  return (
    <div className={styles.page}>
      <Suspense fallback={null}>
        <SharedUrlWatcher onUrl={handleSharedUrl} />
      </Suspense>

      <header className={`${styles.hero} ${compact ? styles.heroCompact : ""}`}>
        <span className={styles.eyebrow}>
          <span className={styles.eyebrowDot} />
          바이브코딩 앱 건강검진
        </span>
        <h1 className={styles.heroTitle}>
          내 사이트, 안전하게
          <br className={styles.mobileBreak} /> 잘 돌아가고 있을까?
        </h1>
        {!compact && (
          <p className={styles.heroSubtitle}>
            주소만 넣으면 보안·기본 상태·기술·SEO를 한 번에 검진하고,
            <br className={styles.desktopBreak} /> 고치는 방법과 AI에게 물어볼 말까지 알려드려요.
          </p>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={styles.input}
            placeholder="my-vibe-app.vercel.app"
            aria-label="진단할 사이트 주소"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className={styles.button} disabled={loading || !url.trim()}>
            {loading ? "검진 중…" : "무료 진단하기"}
          </button>
        </form>

        {!compact && (
          <div className={styles.preview}>
            <p className={styles.previewLabel}>30가지 항목을 살펴봐요</p>
            <ul className={styles.previewList}>
              {PREVIEW_ITEMS.map((item) => (
                <li key={item} className={styles.previewChip}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {loading && (
        <div className={styles.loading} role="status">
          <div className={styles.spinner} />
          <p className={styles.loadingTitle}>사이트를 꼼꼼히 검진하고 있어요</p>
          <p className={styles.loadingSub}>보안 설정, 인증서, 노출된 파일 등을 확인하는 중이에요. 최대 10초 정도 걸려요.</p>
        </div>
      )}

      {error && <div className={styles.error}>⚠️ {error}</div>}

      {view && (
        <div ref={resultsRef} className={styles.results}>
          {view.savedAt ? (
            <div className={styles.banner} data-tone="good">
              <span>{formatKoreanDate(view.savedAt)}에 진단한 기록을 보고 있어요.</span>
              <button type="button" className={styles.bannerAction} onClick={() => runDiagnosis(view.result.inputUrl)}>
                지금 다시 진단
              </button>
            </div>
          ) : (
            view.previous && <ComparisonBanner current={view.result.score} previous={view.previous} />
          )}
          <ResultReport key={`${view.result.inputUrl}-${view.result.fetchedAt}`} result={view.result} />
        </div>
      )}

      {history.length > 0 && (
        <section className={styles.history}>
          <div className={styles.historyHead}>
            <h2 className={styles.historyTitle}>지난 진단 기록</h2>
            <button type="button" className={styles.historyClear} onClick={handleClearHistory}>
              기록 지우기
            </button>
          </div>
          <ul className={styles.historyList}>
            {history.map((entry) => (
              <li key={`${entry.url}-${entry.date}`}>
                <button type="button" className={styles.historyItem} onClick={() => openHistory(entry)}>
                  <span className={styles.historyScore} data-tone={GRADE_TONE[entry.grade]}>
                    {entry.score}
                  </span>
                  <span className={styles.historyText}>
                    <span className={styles.historyUrl}>{entry.url.replace(/^https?:\/\//, "")}</span>
                    <span className={styles.historyDate}>
                      {formatKoreanDate(entry.date)} · {entry.grade}
                    </span>
                  </span>
                  <span className={styles.historyArrow} aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.footer}>
        <p>VibeCheck는 입력하신 URL에 대해 읽기 전용으로만 정보를 확인해요. 공격적인 스캔은 하지 않아요.</p>
        <p>진단 기록은 이 기기의 브라우저에만 저장돼요.</p>
      </footer>
    </div>
  );
}
