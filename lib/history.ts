import type { Check, TechInfo } from "./checks";
import type { Grade } from "./score";

// 클라이언트 전용: localStorage에 진단 기록을 저장한다.

export interface DiagnosisResult {
  inputUrl: string;
  finalUrl: string;
  statusCode: number;
  redirectChain: { url: string; status: number }[];
  ttfbMs: number;
  score: number;
  checks: Check[];
  tech: TechInfo;
  fetchedAt: string;
}

export interface HistoryEntry {
  url: string;
  date: string;
  score: number;
  grade: Grade;
  result: DiagnosisResult;
}

const STORAGE_KEY = "vibecheck-history";
const CHANGE_EVENT = "vibecheck-history-change";
const MAX_ENTRIES = 20;
const EMPTY: HistoryEntry[] = [];

/** "Example.com/" → "https://example.com" 처럼 같은 사이트를 같은 키로 비교할 수 있게 맞춘다. */
export function normalizeHistoryUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return withScheme;
  }
}

function isHistoryEntry(v: unknown): v is HistoryEntry {
  const e = v as HistoryEntry;
  return (
    !!e &&
    typeof e.url === "string" &&
    typeof e.date === "string" &&
    typeof e.score === "number" &&
    typeof e.grade === "string" &&
    !!e.result &&
    Array.isArray(e.result.checks)
  );
}

function parse(raw: string | null): HistoryEntry[] {
  if (!raw) return EMPTY;
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isHistoryEntry) : EMPTY;
  } catch {
    return EMPTY;
  }
}

// useSyncExternalStore용 스냅샷 캐시 (같은 원본 문자열이면 같은 배열을 돌려줘야 함)
let cachedRaw: string | null | undefined;
let cachedEntries: HistoryEntry[] = EMPTY;

/** 최신 기록이 앞에 오는 배열 */
export function getHistorySnapshot(): HistoryEntry[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // 사생활 보호 모드 등에서 localStorage 접근이 막힐 수 있음
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEntries = parse(raw);
  }
  return cachedEntries;
}

export function getHistoryServerSnapshot(): HistoryEntry[] {
  return EMPTY;
}

export function subscribeHistory(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function write(entries: HistoryEntry[]) {
  // 용량 초과 시 오래된 기록부터 덜어내며 재시도
  for (let n = entries.length; n > 0; n--) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, n)));
      break;
    } catch {
      // 다음 루프에서 하나 줄여 재시도
    }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 새 기록을 저장하고, 같은 URL의 직전 기록(있다면)을 돌려준다. */
export function addHistoryEntry(entry: HistoryEntry): HistoryEntry | null {
  const current = getHistorySnapshot();
  const previous = current.find((e) => e.url === entry.url) ?? null;
  write([entry, ...current].slice(0, MAX_ENTRIES));
  return previous;
}

export function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function formatKoreanDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
