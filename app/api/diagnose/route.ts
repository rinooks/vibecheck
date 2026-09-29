import { NextRequest, NextResponse } from "next/server";
import { safeFetch, safeFetchPath, SsrfBlockedError, FetchTimeoutError } from "@/lib/fetcher";
import { validateUrlSyntax, normalizeInputUrl } from "@/lib/ssrf";
import { buildChecks, extractTech, type DiagnosisContext } from "@/lib/checks";
import { calculateScore } from "@/lib/score";
import { probeErrorPage, probeSourcemaps, probeTlsDaysUntilExpiry } from "@/lib/probes";

const EXPOSED_PATHS = [".env", ".git/HEAD", "wp-config.php", ".DS_Store", "server-status"] as const;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }

  const inputUrl = (body as { url?: unknown })?.url;
  if (typeof inputUrl !== "string" || !inputUrl.trim()) {
    return NextResponse.json({ error: "진단할 URL을 입력해 주세요." }, { status: 400 });
  }

  const trimmedUrl = normalizeInputUrl(inputUrl);

  const syntaxCheck = validateUrlSyntax(trimmedUrl);
  if (!syntaxCheck.ok) {
    return NextResponse.json({ error: syntaxCheck.reason }, { status: 400 });
  }

  try {
    const result = await safeFetch(trimmedUrl);

    // 부가 체크는 모두 병렬로 (Vercel Hobby 10초 함수 제한)
    const [exposedResults, sourcemapProbes, tlsDaysUntilExpiry, errorPageProbe] = await Promise.all([
      Promise.all(EXPOSED_PATHS.map((path) => safeFetchPath(result.finalUrl, "/" + path))),
      probeSourcemaps(result.body, result.finalUrl),
      probeTlsDaysUntilExpiry(result.finalUrl),
      probeErrorPage(result.finalUrl),
    ]);
    const [exposedEnv, exposedGit, exposedWpConfig, exposedDsStore, exposedServerStatus] = exposedResults;

    const ctx: DiagnosisContext = {
      inputUrl: trimmedUrl,
      finalUrl: result.finalUrl,
      statusCode: result.statusCode,
      headers: result.headers,
      body: result.body,
      redirectChain: result.redirectChain,
      ttfbMs: result.ttfbMs,
      exposedEnv,
      exposedGit,
      exposedWpConfig,
      exposedDsStore,
      exposedServerStatus,
      sourcemapProbes,
      tlsDaysUntilExpiry,
      errorPageProbe,
    };

    const checks = buildChecks(ctx);
    const score = calculateScore(checks);
    const tech = extractTech(ctx);

    return NextResponse.json({
      inputUrl: trimmedUrl,
      finalUrl: result.finalUrl,
      statusCode: result.statusCode,
      redirectChain: result.redirectChain,
      ttfbMs: result.ttfbMs,
      score,
      checks,
      tech,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: err.message || "이 URL은 진단할 수 없어요." }, { status: 400 });
    }
    if (err instanceof FetchTimeoutError) {
      return NextResponse.json({ error: err.message || "응답 시간이 초과됐어요." }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.";
    return NextResponse.json({ error: `사이트에 접속할 수 없어요: ${message}` }, { status: 502 });
  }
}
