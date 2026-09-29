import { lookup } from "dns";
import { randomBytes } from "crypto";
import { isIP } from "net";
import tls from "tls";
import { safeFetchPath } from "./fetcher";
import { isBlockedIp, validateUrlFully } from "./ssrf";
import type { ExposedFetchResult, SourcemapProbe } from "./checks";

// 부가 체크는 Vercel Hobby 10초 함수 제한을 고려해 짧게 끊는다.
const PROBE_TIMEOUT_MS = 5_000;
const MAX_SOURCEMAP_PROBES = 5;
// 소스맵은 "sources"/"mappings" 키가 파일 앞부분에 나오므로 앞부분만 읽는다.
const SOURCEMAP_MAX_BYTES = 64 * 1024;
const ERROR_PAGE_MAX_BYTES = 256 * 1024;

/** HTML의 <script src>에서 finalUrl과 같은 origin인 .js 파일 URL을 최대 5개 고른다. */
export function findSameOriginScriptUrls(html: string, finalUrl: string): string[] {
  const origin = new URL(finalUrl).origin;
  const re = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && found.size < MAX_SOURCEMAP_PROBES) {
    const src = (m[1] ?? m[2] ?? m[3]).trim();
    let url: URL;
    try {
      url = new URL(src, finalUrl);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!url.pathname.endsWith(".js")) continue;
    url.search = "";
    url.hash = "";
    found.add(url.toString());
  }
  return Array.from(found);
}

export async function probeSourcemaps(html: string, finalUrl: string): Promise<SourcemapProbe[]> {
  const origin = new URL(finalUrl).origin;
  const jsUrls = findSameOriginScriptUrls(html, finalUrl);
  return Promise.all(
    jsUrls.map(async (jsUrl) => {
      const mapUrl = jsUrl + ".map";
      const result = await safeFetchPath(origin, mapUrl, { timeoutMs: PROBE_TIMEOUT_MS, maxBytes: SOURCEMAP_MAX_BYTES });
      return { mapUrl, result };
    })
  );
}

export async function probeErrorPage(finalUrl: string): Promise<ExposedFetchResult | null> {
  const suffix = randomBytes(4).toString("hex"); // 8자리
  return safeFetchPath(finalUrl, `/vibecheck-404-probe-${suffix}`, {
    timeoutMs: PROBE_TIMEOUT_MS,
    maxBytes: ERROR_PAGE_MAX_BYTES,
    readBodyOnAnyStatus: true,
  });
}

/**
 * https 사이트의 443 포트로 TLS 접속해 인증서 만료까지 남은 일수를 구한다.
 * 접속 전에 validateUrlFully로 SSRF 검증을 하고, 실제 접속 시점의 DNS 결과도 다시 검사한다(리바인딩 방어).
 * 실패하면 조용히 null.
 */
export async function probeTlsDaysUntilExpiry(finalUrl: string): Promise<number | null> {
  let hostname: string;
  try {
    const url = new URL(finalUrl);
    if (url.protocol !== "https:") return null;
    hostname = url.hostname.replace(/^\[|\]$/g, "");
    const validated = await validateUrlFully(`https://${url.host}/`);
    if (!validated.ok) return null;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    let socket: tls.TLSSocket | undefined;
    // socket timeout은 유휴 시간 기준이라, 전체 소요 시간 상한을 따로 둔다.
    const hardTimeout = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      socket?.destroy();
      resolve(value);
    };

    try {
      socket = tls.connect({
        host: hostname,
        port: 443,
        // IP 주소에는 SNI를 설정할 수 없다.
        servername: isIP(hostname) ? undefined : hostname,
        // 만료·자체서명 인증서도 정보를 읽어야 하므로 검증 실패로 끊지 않는다(데이터 전송 없음).
        rejectUnauthorized: false,
        timeout: PROBE_TIMEOUT_MS,
        // 실제 접속 시점의 DNS 결과도 사설 대역이면 차단 (autoSelectFamily 사용 시 all: true 배열로 온다)
        lookup: (host, opts, callback) => {
          lookup(host, opts, (err, address, family) => {
            const ips = Array.isArray(address) ? address.map((a) => a.address) : [address];
            if (!err && ips.some((ip) => isBlockedIp(ip))) {
              callback(new Error("blocked address"), address, family);
              return;
            }
            callback(err, address, family);
          });
        },
      });

      socket.once("secureConnect", () => {
        const cert = socket?.getPeerCertificate();
        const validTo = cert?.valid_to ? new Date(cert.valid_to).getTime() : NaN;
        if (Number.isNaN(validTo)) {
          finish(null);
          return;
        }
        finish(Math.floor((validTo - Date.now()) / 86_400_000));
      });
      socket.once("timeout", () => finish(null));
      socket.once("error", () => finish(null));
    } catch {
      finish(null);
    }
  });
}
