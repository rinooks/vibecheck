import { validateUrlFully } from "./ssrf";

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 5;
const USER_AGENT = "VibeCheck/1.0 (+passive site diagnostic; read-only)";

export interface RedirectHop {
  url: string;
  status: number;
}

export interface SafeFetchResult {
  finalUrl: string;
  statusCode: number;
  headers: Headers;
  body: string;
  redirectChain: RedirectHop[];
  ttfbMs: number;
}

export class SsrfBlockedError extends Error {}
export class FetchTimeoutError extends Error {}

async function fetchOneHop(url: URL, signal: AbortSignal): Promise<{ res: Response; ttfbMs: number }> {
  const start = performance.now();
  const res = await fetch(url.toString(), {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    },
  });
  const ttfbMs = Math.round(performance.now() - start);
  return { res, ttfbMs };
}

async function readBodyCapped(res: Response, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        await reader.cancel();
        break;
      }
      const slice = value.length > remaining ? value.slice(0, remaining) : value;
      chunks.push(slice);
      total += slice.length;
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * SSRF 방어가 적용된 fetch. 매 리다이렉트 홉마다 URL 검증(스킴/사설대역/DNS)을 반복하고,
 * 최종 응답만 본문을 읽는다(중간 홉은 본문을 읽지 않음).
 */
export async function safeFetch(inputUrl: string): Promise<SafeFetchResult> {
  const redirectChain: RedirectHop[] = [];
  let currentUrl = inputUrl;
  let totalTtfbMs = 0;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const validated = await validateUrlFully(currentUrl);
      if (!validated.ok) {
        throw new SsrfBlockedError(validated.reason);
      }

      const { res, ttfbMs } = await fetchOneHop(validated.url, controller.signal);
      if (hop === 0) totalTtfbMs = ttfbMs;

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        redirectChain.push({ url: currentUrl, status: res.status });
        const location = res.headers.get("location")!;
        currentUrl = new URL(location, validated.url).toString();

        if (hop === MAX_REDIRECTS) {
          throw new Error("리다이렉트 횟수가 너무 많아요 (5회 초과).");
        }
        continue;
      }

      const body = await readBodyCapped(res);
      return {
        finalUrl: currentUrl,
        statusCode: res.status,
        headers: res.headers,
        body,
        redirectChain,
        ttfbMs: totalTtfbMs,
      };
    }

    throw new Error("리다이렉트 처리 중 알 수 없는 오류가 발생했어요.");
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
    if (controller.signal.aborted) {
      throw new FetchTimeoutError("응답이 너무 느려서 10초 만에 진단을 중단했어요.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface SafeFetchPathOptions {
  /** 기본 10초. 부가 체크는 함수 실행 시간 제한을 고려해 더 짧게 줄 수 있다. */
  timeoutMs?: number;
  /** 기본 2MB. 앞부분만 보면 되는 체크는 작게 줄 수 있다. */
  maxBytes?: number;
  /** 기본 false(200일 때만 본문을 읽음). 404 에러 페이지처럼 비-200 본문이 필요할 때 true. */
  readBodyOnAnyStatus?: boolean;
}

/**
 * 노출 경로(/.env 등) 확인용 보조 fetch. 반드시 같은 호스트에서만 호출할 것.
 * 리다이렉트를 따라가지 않고, 실패 시 조용히 null을 반환한다(부가 체크이므로).
 */
export async function safeFetchPath(
  baseUrl: string,
  path: string,
  options: SafeFetchPathOptions = {}
): Promise<{ status: number; body: string } | null> {
  const { timeoutMs = TIMEOUT_MS, maxBytes = MAX_BODY_BYTES, readBodyOnAnyStatus = false } = options;
  try {
    const target = new URL(path, baseUrl);
    const validated = await validateUrlFully(target.toString());
    if (!validated.ok) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(validated.url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      const body = res.status === 200 || readBodyOnAnyStatus ? await readBodyCapped(res, maxBytes) : "";
      return { status: res.status, body };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}
