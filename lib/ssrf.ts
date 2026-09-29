import { resolve4, resolve6 } from "dns/promises";
import { isIP } from "net";

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

// 사설/특수 IPv4 대역 (CIDR) — RFC1918, 루프백, 링크로컬, 메타데이터 등
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // 169.254.169.254 클라우드 메타데이터 포함
  ["0.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // 멀티캐스트
  ["240.0.0.0", 4], // 예약됨
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4Blocked(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  });
}

function isIpv6Blocked(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.replace("::ffff:", "");
    if (isIP(mapped) === 4) return isIpv4Blocked(mapped);
  }
  // fc00::/7 (Unique Local Address)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // fe80::/10 (Link-local)
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isIpv4Blocked(ip);
  if (version === 6) return isIpv6Blocked(ip);
  return true; // 파싱 불가능한 값은 안전하게 차단
}

export function isBlockedHostnameLiteral(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".localhost")) return true;
  if (lower === "metadata.google.internal") return true;
  return false;
}

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

/** URL 문법 검증: 스킴, 포트, userinfo 등. DNS 조회는 하지 않음. */
export function validateUrlSyntax(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL 형식이 올바르지 않아요." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "http 또는 https 주소만 진단할 수 있어요." };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "인증 정보(아이디/비밀번호)가 포함된 URL은 진단할 수 없어요." };
  }

  const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    return { ok: false, reason: "허용되지 않는 포트예요. 일반적인 웹 포트(80/443)만 가능해요." };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostnameLiteral(hostname)) {
    return { ok: false, reason: "내부/사설 주소는 진단할 수 없어요." };
  }

  const ipVersion = isIP(hostname);
  if (ipVersion && isBlockedIp(hostname)) {
    return { ok: false, reason: "내부/사설 IP 대역은 진단할 수 없어요." };
  }

  return { ok: true, url };
}

/**
 * 호스트명의 모든 A/AAAA 레코드를 조회해 사설 대역이 하나라도 있으면 차단한다.
 * DNS 리바인딩(응답 시점엔 안전한 IP, 실제 fetch 시점엔 사설 IP) 1차 방어.
 */
export async function resolveAndValidateHost(hostname: string): Promise<SsrfCheckResult> {
  const ipVersion = isIP(hostname);
  if (ipVersion) {
    return isBlockedIp(hostname) ? { ok: false, reason: "내부/사설 IP 대역은 진단할 수 없어요." } : { ok: true };
  }

  if (isBlockedHostnameLiteral(hostname)) {
    return { ok: false, reason: "내부/사설 주소는 진단할 수 없어요." };
  }

  const addresses: string[] = [];
  let resolvedAny = false;

  try {
    const v4 = await resolve4(hostname);
    addresses.push(...v4);
    resolvedAny = true;
  } catch {
    // v4 없을 수 있음
  }

  try {
    const v6 = await resolve6(hostname);
    addresses.push(...v6);
    resolvedAny = true;
  } catch {
    // v6 없을 수 있음
  }

  if (!resolvedAny || addresses.length === 0) {
    return { ok: false, reason: "도메인의 IP 주소를 찾을 수 없어요." };
  }

  const blocked = addresses.some((ip) => isBlockedIp(ip));
  if (blocked) {
    return { ok: false, reason: "이 도메인은 내부/사설 IP로 연결돼 있어 진단할 수 없어요." };
  }

  return { ok: true };
}

/** URL 문법 + DNS 기반 검증을 한 번에 수행 */
export async function validateUrlFully(rawUrl: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  const syntaxResult = validateUrlSyntax(rawUrl);
  if (!syntaxResult.ok) return syntaxResult;

  const hostname = syntaxResult.url.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(hostname);
  if (!ipVersion) {
    const dnsResult = await resolveAndValidateHost(hostname);
    if (!dnsResult.ok) return { ok: false, reason: dnsResult.reason! };
  }

  return { ok: true, url: syntaxResult.url };
}
