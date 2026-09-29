import type { RedirectHop } from "./fetcher";

export type CheckStatus = "pass" | "warning" | "danger";
export type CheckCategory = "보안" | "기본 상태" | "기술" | "SEO";

export interface Check {
  id: string;
  category: CheckCategory;
  title: string;
  status: CheckStatus;
  why: string;
  howToFix: string;
  aiPrompt: string;
  details: string;
}

export interface TechInfo {
  generator: string | null;
  jquery: string | null;
  server: string | null;
}

export interface ExposedFetchResult {
  status: number;
  body: string;
}

export interface SourcemapProbe {
  mapUrl: string;
  result: ExposedFetchResult | null;
}

export interface DiagnosisContext {
  inputUrl: string;
  finalUrl: string;
  statusCode: number;
  headers: Headers;
  body: string;
  redirectChain: RedirectHop[];
  ttfbMs: number;
  exposedEnv: ExposedFetchResult | null;
  exposedGit: ExposedFetchResult | null;
  exposedWpConfig: ExposedFetchResult | null;
  exposedDsStore: ExposedFetchResult | null;
  exposedServerStatus: ExposedFetchResult | null;
  sourcemapProbes: SourcemapProbe[];
  tlsDaysUntilExpiry: number | null;
  errorPageProbe: ExposedFetchResult | null;
}

// ---------- HTML 파싱 헬퍼 (경량, 추가 의존성 없이 정규식 기반) ----------

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

function findMetaContent(html: string, key: "name" | "property", value: string): string | null {
  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const attrs = parseAttrs(m[0]);
    if (attrs[key]?.toLowerCase() === value.toLowerCase()) {
      return attrs["content"] ?? null;
    }
  }
  return null;
}

function findMetaExists(html: string, key: "name" | "property", value: string): boolean {
  return findMetaContent(html, key, value) !== null;
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim();
}

function extractHtmlLang(html: string): string | null {
  const m = /<html\b[^>]*>/i.exec(html);
  if (!m) return null;
  const attrs = parseAttrs(m[0]);
  return attrs["lang"] || null;
}

function extractJquery(html: string): string | null {
  const m = /jquery[-.]?(\d+\.\d+\.\d+)(?:\.min|\.slim)?\.js/i.exec(html);
  return m ? m[1] : null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function findMixedContentUrls(html: string): string[] {
  const re = /(?:src|href)\s*=\s*"(http:\/\/[^"]+)"/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

// ---------- 개별 체크 ----------

function checkHttps(ctx: DiagnosisContext): Check {
  const isHttps = ctx.finalUrl.startsWith("https://");
  return {
    id: "https",
    category: "보안",
    title: "HTTPS 사용 여부",
    status: isHttps ? "pass" : "danger",
    why: "HTTPS를 사용하지 않으면 방문자와 사이트 사이의 통신이 암호화되지 않아, 같은 와이파이를 쓰는 다른 사람이 비밀번호나 개인정보를 훔쳐볼 수 있어요. 요즘 브라우저는 http 사이트에 '안전하지 않음' 경고도 띄워요.",
    howToFix: "Vercel, Netlify 같은 호스팅을 쓰고 있다면 커스텀 도메인을 연결하기만 해도 자동으로 HTTPS(SSL 인증서)가 적용돼요. 직접 서버를 운영 중이라면 Let's Encrypt 같은 무료 인증서를 설치하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}가 HTTPS를 사용하지 않고 있어. 통신이 암호화되지 않아서 개인정보가 노출될 위험이 있대. 내가 쓰는 호스팅(예: Vercel, Netlify, 또는 직접 서버)에서 HTTPS(SSL 인증서)를 적용하는 방법을 단계별로 쉽게 알려줘. 나는 비개발자야.`,
    details: isHttps ? "https로 접속되고 있어요." : "http로 접속되고 있어요 (암호화 없음).",
  };
}

function headerCheck(
  ctx: DiagnosisContext,
  id: string,
  title: string,
  headerName: string,
  why: string,
  howToFix: string,
  aiPromptTemplate: (url: string) => string
): Check {
  const value = ctx.headers.get(headerName);
  return {
    id,
    category: "보안",
    title,
    status: value ? "pass" : "warning",
    why,
    howToFix,
    aiPrompt: aiPromptTemplate(ctx.inputUrl),
    details: value ? `${headerName}: ${value}` : `${headerName} 헤더가 응답에 없어요.`,
  };
}

function checkHsts(ctx: DiagnosisContext): Check {
  return headerCheck(
    ctx,
    "hsts",
    "HSTS (강제 HTTPS)",
    "strict-transport-security",
    "이 설정이 없으면 사용자가 실수로 http:// 로 접속했을 때 암호화 없이 연결될 틈이 생겨요. 공격자가 그 틈을 이용해 통신을 가로챌 수 있어요(SSL Strip 공격).",
    "호스팅 설정이나 서버 설정에서 'Strict-Transport-Security' 응답 헤더를 추가하세요. Vercel/Netlify는 설정 파일(next.config, vercel.json 등)에서 헤더를 지정할 수 있어요.",
    (url) => `내 웹사이트 ${url}에 Strict-Transport-Security(HSTS) 헤더가 없어서 사용자가 http로 접속할 때 암호화 없이 연결될 위험이 있대. 이 헤더를 추가해서 항상 HTTPS로 강제 연결되도록 코드를 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`
  );
}

function checkCsp(ctx: DiagnosisContext): Check {
  return headerCheck(
    ctx,
    "csp",
    "CSP (콘텐츠 보안 정책)",
    "content-security-policy",
    "이 설정이 없으면 만약 내 사이트에 악성 스크립트가 몰래 삽입됐을 때(XSS) 브라우저가 이를 걸러내지 못하고 그대로 실행할 수 있어요.",
    "서버 응답 헤더에 Content-Security-Policy를 추가하세요. 처음에는 스크립트 출처를 허용 목록으로 지정하는 것부터 시작하면 돼요.",
    (url) => `내 웹사이트 ${url}에 Content-Security-Policy(CSP) 헤더가 없어서 악성 스크립트 삽입(XSS) 공격에 취약할 수 있대. 기본적인 CSP 헤더를 추가하는 코드를 작성해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`
  );
}

function checkXFrameOptions(ctx: DiagnosisContext): Check {
  return headerCheck(
    ctx,
    "x-frame-options",
    "클릭재킹 방지 (X-Frame-Options)",
    "x-frame-options",
    "이 설정이 없으면 다른 악성 사이트가 내 사이트를 투명한 iframe으로 몰래 띄워놓고, 방문자가 그 악성 사이트를 클릭한 줄 알았는데 실제로는 내 사이트의 버튼을 누르게 속일 수 있어요(클릭재킹).",
    "서버 응답 헤더에 X-Frame-Options: SAMEORIGIN 을 추가하세요.",
    (url) => `내 웹사이트 ${url}에 X-Frame-Options 헤더가 없어서 클릭재킹 공격에 취약할 수 있대. X-Frame-Options: SAMEORIGIN 헤더를 추가하는 코드를 작성해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`
  );
}

function checkXContentTypeOptions(ctx: DiagnosisContext): Check {
  return headerCheck(
    ctx,
    "x-content-type-options",
    "MIME 스니핑 방지",
    "x-content-type-options",
    "이 설정이 없으면 브라우저가 파일 종류를 임의로 추측하다가, 이미지인 척 업로드된 악성 스크립트를 실행해버릴 수 있어요.",
    "서버 응답 헤더에 X-Content-Type-Options: nosniff 를 추가하세요.",
    (url) => `내 웹사이트 ${url}에 X-Content-Type-Options 헤더가 없대. nosniff 값으로 이 헤더를 추가하는 코드를 작성해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`
  );
}

function checkReferrerPolicy(ctx: DiagnosisContext): Check {
  return headerCheck(
    ctx,
    "referrer-policy",
    "리퍼러 정책",
    "referrer-policy",
    "이 설정이 없으면 사용자가 내 사이트의 링크를 눌러 다른 사이트로 이동할 때, 내 사이트의 전체 주소(가끔은 검색어나 개인 정보가 담긴 URL)가 그대로 다음 사이트에 전달될 수 있어요.",
    "서버 응답 헤더에 Referrer-Policy: strict-origin-when-cross-origin 을 추가하세요.",
    (url) => `내 웹사이트 ${url}에 Referrer-Policy 헤더가 없어서 외부 링크 이동 시 URL 정보가 과도하게 노출될 수 있대. strict-origin-when-cross-origin 값으로 헤더를 추가하는 코드를 작성해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`
  );
}

function checkPermissionsPolicy(ctx: DiagnosisContext): Check {
  const value = ctx.headers.get("permissions-policy");
  return {
    id: "permissions-policy",
    category: "보안",
    title: "권한 정책 (카메라/마이크 등)",
    status: value ? "pass" : "warning",
    why: "이 설정이 없으면 내 사이트에 삽입된 외부 스크립트나 광고가 카메라, 마이크, 위치정보 같은 민감한 브라우저 기능을 마음대로 요청할 여지가 남아요. 우선순위는 낮은 편이에요.",
    howToFix: "서버 응답 헤더에 Permissions-Policy를 추가해 카메라/마이크/위치정보 등 필요 없는 기능을 명시적으로 꺼두세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에 Permissions-Policy 헤더가 없어서 불필요한 브라우저 권한(카메라, 마이크, 위치정보 등)이 열려있을 수 있대. 필요 없는 기능을 차단하는 Permissions-Policy 헤더를 추가하는 코드를 작성해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: value ? `permissions-policy: ${value}` : "permissions-policy 헤더가 응답에 없어요.",
  };
}

function exposedPathCheck(
  id: string,
  title: string,
  result: ExposedFetchResult | null,
  pattern: RegExp,
  why: string,
  howToFix: string,
  aiPromptTemplate: (url: string) => string,
  path: string,
  inputUrl: string,
  dangerStatus: CheckStatus = "danger"
): Check {
  const exposed = !!result && result.status === 200 && pattern.test(result.body);
  return {
    id,
    category: "보안",
    title,
    status: exposed ? dangerStatus : "pass",
    why,
    howToFix,
    aiPrompt: aiPromptTemplate(inputUrl),
    details: exposed
      ? `${path} 경로가 외부에 그대로 노출돼 있어요.`
      : `${path} 경로는 노출되지 않았어요 (상태코드: ${result?.status ?? "확인 불가"}).`,
  };
}

function checkExposedEnv(ctx: DiagnosisContext): Check {
  return exposedPathCheck(
    "exposed-env",
    "환경변수 파일(.env) 노출",
    ctx.exposedEnv,
    /APP_KEY|DB_PASSWORD|SECRET/i,
    ".env 파일에는 데이터베이스 비밀번호, API 키 같은 아주 민감한 정보가 들어있어요. 이 파일이 인터넷에 그대로 노출되면 누구나 내 서비스의 데이터베이스나 외부 서비스 계정에 접근할 수 있어요.",
    "배포 설정에서 .env 파일이 정적 파일로 서빙되지 않도록 막고, 즉시 노출된 키들을 모두 재발급(rotate)하세요. Next.js/Vercel이라면 .env는 기본적으로 서빙되지 않으니, 커스텀 서버 설정을 점검하세요.",
    (url) => `내 웹사이트 ${url}에서 .env 파일이 외부에 그대로 노출되고 있어. 이 파일에 비밀번호나 API 키 같은 민감정보가 있는데 유출 위험이 있대. .env 파일이 절대 외부에서 접근되지 않도록 서버/배포 설정을 고쳐줘. 그리고 이미 노출된 키는 재발급해야 한다는 것도 알려줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    "/.env",
    ctx.inputUrl
  );
}

function checkExposedGit(ctx: DiagnosisContext): Check {
  return exposedPathCheck(
    "exposed-git",
    ".git 저장소 노출",
    ctx.exposedGit,
    /ref:/i,
    ".git 폴더가 노출되면 내 프로젝트의 전체 소스코드와 커밋 기록(과거에 실수로 넣었던 비밀번호 포함)을 통째로 내려받을 수 있어요.",
    "배포 시 .git 폴더가 결과물에 포함되지 않도록 하세요. Vercel/Netlify 같은 플랫폼은 기본적으로 제외하지만, 직접 서버를 운영 중이라면 웹서버 설정에서 .git 경로 접근을 차단하세요.",
    (url) => `내 웹사이트 ${url}에서 .git/HEAD 파일이 외부에 노출되고 있어. 이러면 내 소스코드 전체와 커밋 기록을 누구나 내려받을 수 있대. .git 폴더가 웹에서 절대 접근되지 않도록 서버/배포 설정을 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    "/.git/HEAD",
    ctx.inputUrl
  );
}

function checkExposedWpConfig(ctx: DiagnosisContext): Check {
  return exposedPathCheck(
    "exposed-wpconfig",
    "wp-config.php 노출",
    ctx.exposedWpConfig,
    /DB_PASSWORD/i,
    "워드프레스 설정 파일에는 데이터베이스 접속 정보가 그대로 담겨 있어요. 노출되면 사이트 전체 데이터를 탈취당할 수 있어요.",
    "호스팅사 고객센터에 즉시 문의하고, 웹서버 설정에서 wp-config.php 직접 접근을 차단하세요. 데이터베이스 비밀번호도 바로 변경하세요.",
    (url) => `내 워드프레스 사이트 ${url}에서 wp-config.php 파일이 외부에 노출되고 있어. 데이터베이스 비밀번호가 그대로 유출될 위험이 있대. 이 파일에 대한 외부 접근을 차단하는 방법을 알려주고, 비밀번호도 바꿔야 한다고 안내해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    "/wp-config.php",
    ctx.inputUrl
  );
}

function checkExposedDsStore(ctx: DiagnosisContext): Check {
  const result = ctx.exposedDsStore;
  const exposed = !!result && result.status === 200;
  return {
    id: "exposed-dsstore",
    category: "보안",
    title: ".DS_Store 파일 노출",
    status: exposed ? "warning" : "pass",
    why: ".DS_Store는 macOS가 자동으로 만드는 폴더 목록 파일이에요. 이게 노출되면 내 서버의 폴더 구조나 파일 이름이 외부에 드러날 수 있어요.",
    howToFix: "배포 시 .DS_Store 같은 시스템 파일이 함께 업로드되지 않도록 .gitignore와 배포 제외 목록에 추가하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에서 .DS_Store 파일이 노출되고 있어. 서버 폴더 구조가 드러날 수 있대. 이 파일이 배포에 포함되지 않도록 설정을 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: exposed ? "/.DS_Store 파일이 그대로 열람 가능해요." : "/.DS_Store 노출은 발견되지 않았어요.",
  };
}

function checkExposedServerStatus(ctx: DiagnosisContext): Check {
  const result = ctx.exposedServerStatus;
  const exposed = !!result && result.status === 200;
  return {
    id: "exposed-server-status",
    category: "보안",
    title: "서버 상태 페이지(/server-status) 노출",
    status: exposed ? "warning" : "pass",
    why: "Apache의 서버 상태 페이지가 외부에 열려 있으면, 다른 방문자의 IP 주소나 현재 요청 중인 URL 같은 내부 정보가 그대로 보일 수 있어요.",
    howToFix: "웹서버(Apache) 설정에서 /server-status 접근을 내부 IP로만 제한하거나 비활성화하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에서 /server-status 페이지가 외부에 노출되고 있어. 서버 내부 정보가 드러날 수 있대. 이 페이지를 외부에서 접근하지 못하도록 웹서버 설정을 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: exposed ? "/server-status 페이지가 열람 가능해요." : "/server-status 노출은 발견되지 않았어요.",
  };
}

function checkMixedContent(ctx: DiagnosisContext): Check {
  const isHttps = ctx.finalUrl.startsWith("https://");
  const mixedUrls = isHttps ? findMixedContentUrls(ctx.body) : [];
  const hasMixed = mixedUrls.length > 0;
  return {
    id: "mixed-content",
    category: "보안",
    title: "혼합 콘텐츠 (Mixed Content)",
    status: hasMixed ? "warning" : "pass",
    why: "HTTPS 페이지 안에서 이미지나 스크립트를 http:// 로 불러오면, 그 부분만 암호화되지 않아 브라우저가 경고를 띄우거나 콘텐츠를 아예 막을 수 있어요.",
    howToFix: "http://로 시작하는 이미지·스크립트·링크 주소를 모두 https://로 바꾸거나, 프로토콜을 생략한 상대경로(//도메인/...)로 바꾸세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}는 HTTPS인데 내부에서 http://로 리소스(이미지, 스크립트 등)를 ${mixedUrls.length}개 불러오고 있어서 혼합 콘텐츠 경고가 떠. 이 http:// 주소들을 모두 https://로 바꿔줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: hasMixed
      ? `http://로 시작하는 리소스 ${mixedUrls.length}개 발견 (예: ${mixedUrls[0]})`
      : "http://로 로드되는 리소스가 발견되지 않았어요.",
  };
}

function checkSourcemapExposure(ctx: DiagnosisContext): Check {
  const exposed = ctx.sourcemapProbes.filter(
    (p) => p.result?.status === 200 && /"sources"|"mappings"/.test(p.result.body)
  );
  const checked = ctx.sourcemapProbes.length;
  return {
    id: "sourcemap-exposure",
    category: "보안",
    title: "소스맵(.map) 파일 노출",
    status: exposed.length > 0 ? "warning" : "pass",
    why: "소스맵(.js.map)은 압축된 자바스크립트를 원래 코드로 되돌려주는 파일이에요. 이게 공개돼 있으면 누구나 내 앱의 원본 코드를 그대로 읽을 수 있어서, 코드에 남겨둔 API 주소나 숨겨둔 로직이 드러날 수 있어요.",
    howToFix: "프로덕션 빌드에서 소스맵을 만들지 않거나 외부에 올리지 않도록 설정하세요. Next.js는 기본적으로 브라우저용 소스맵을 공개하지 않으니 productionBrowserSourceMaps 설정이 켜져 있는지 확인하세요. Vite는 build.sourcemap 옵션을 끄면 돼요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에서 자바스크립트 소스맵(.js.map) 파일이 외부에 공개돼 있어서 원본 소스코드가 그대로 보인대. 프로덕션 배포에서 소스맵이 공개되지 않도록 빌드 설정을 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details:
      exposed.length > 0
        ? `소스맵 ${exposed.length}개가 열람 가능해요 (예: ${exposed[0].mapUrl})`
        : checked > 0
        ? `같은 사이트의 스크립트 ${checked}개를 확인했고, 공개된 소스맵은 없었어요.`
        : "확인할 같은 사이트 스크립트가 없었어요.",
  };
}

function checkTlsExpiry(ctx: DiagnosisContext): Check {
  const isHttps = ctx.finalUrl.startsWith("https://");
  const days = ctx.tlsDaysUntilExpiry;
  let status: CheckStatus = "pass";
  if (isHttps && days !== null) {
    if (days < 14) status = "danger";
    else if (days < 30) status = "warning";
  }

  let details: string;
  if (!isHttps) details = "http 사이트라 해당 없어요";
  else if (days === null) details = "인증서 정보를 가져오지 못했어요";
  else if (days < 0) details = `인증서가 ${Math.abs(days)}일 전에 만료됐어요.`;
  else details = `인증서 만료까지 ${days}일 남았어요.`;

  return {
    id: "tls-expiry",
    category: "보안",
    title: "SSL 인증서 만료일",
    status,
    why: "SSL 인증서가 만료되면 방문자 브라우저에 '연결이 비공개로 설정되어 있지 않습니다' 같은 무서운 경고가 전체 화면으로 떠요. 대부분의 방문자는 그 자리에서 떠나버려요.",
    howToFix: "Vercel, Netlify, Cloudflare 같은 플랫폼은 인증서를 자동으로 갱신해 주니 도메인 연결 상태를 확인하세요. 직접 서버를 운영 중이라면 Let's Encrypt(certbot)의 자동 갱신이 제대로 돌고 있는지 점검하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}의 SSL 인증서가 ${days !== null && days >= 0 ? `${days}일 뒤에` : "이미"} 만료된대. 인증서를 갱신하고, 앞으로는 자동으로 갱신되도록 설정하는 방법을 알려줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details,
  };
}

interface CookieIssue {
  name: string;
  missing: string[];
}

function findCookieIssues(setCookies: string[], isHttps: boolean): CookieIssue[] {
  const issues: CookieIssue[] = [];
  for (const raw of setCookies) {
    const [pair, ...attrParts] = raw.split(";");
    const name = pair.split("=")[0].trim() || "(이름 없음)";
    const attrs = attrParts.map((a) => a.trim().toLowerCase());
    const missing: string[] = [];
    if (isHttps && !attrs.includes("secure")) missing.push("Secure");
    if (!attrs.includes("httponly")) missing.push("HttpOnly");
    if (!attrs.some((a) => a.startsWith("samesite"))) missing.push("SameSite");
    if (missing.length > 0) issues.push({ name, missing });
  }
  return issues;
}

function checkCookieFlags(ctx: DiagnosisContext): Check {
  const setCookies = ctx.headers.getSetCookie();
  const isHttps = ctx.finalUrl.startsWith("https://");
  const issues = findCookieIssues(setCookies, isHttps);
  const summary = issues.map((i) => `${i.name}(${i.missing.join(", ")} 없음)`).join(", ");
  return {
    id: "cookie-flags",
    category: "보안",
    title: "쿠키 보안 설정",
    status: issues.length > 0 ? "warning" : "pass",
    why: "쿠키에 보안 옵션이 빠져 있으면 로그인 정보가 담긴 쿠키를 악성 스크립트가 훔쳐가거나(HttpOnly 없음), 암호화 안 된 통신으로 새어 나가거나(Secure 없음), 다른 사이트가 내 사이트인 척 요청을 보낼 때 쿠키가 따라갈 수 있어요(SameSite 없음).",
    howToFix: "쿠키를 만드는 코드(로그인, 세션 등)에서 Secure, HttpOnly, SameSite=Lax 옵션을 함께 지정하세요. 자바스크립트에서 꼭 읽어야 하는 쿠키가 아니라면 HttpOnly는 켜두는 게 좋아요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}가 보내는 쿠키 중에 보안 옵션이 빠진 게 있대: ${summary || "없음"}. 각 쿠키에 Secure, HttpOnly, SameSite 옵션을 알맞게 추가하도록 코드를 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details:
      setCookies.length === 0
        ? "응답에 Set-Cookie가 없어요."
        : issues.length > 0
        ? `보안 옵션이 빠진 쿠키: ${summary}`
        : `쿠키 ${setCookies.length}개 모두 보안 옵션이 설정돼 있어요.`,
  };
}

function checkCorsWildcard(ctx: DiagnosisContext): Check {
  const value = ctx.headers.get("access-control-allow-origin");
  const isWildcard = value?.trim() === "*";
  return {
    id: "cors-wildcard",
    category: "보안",
    title: "CORS 전체 허용 (*)",
    status: isWildcard ? "warning" : "pass",
    why: "Access-Control-Allow-Origin: * 는 '세상의 모든 사이트가 내 서버 응답을 읽어가도 된다'는 뜻이에요. 공개 API라면 괜찮지만, 로그인한 사용자 정보를 돌려주는 곳이라면 다른 사이트가 그 데이터를 몰래 가져갈 여지가 생겨요.",
    howToFix: "정말로 모든 사이트에 공개해야 하는 게 아니라면, 허용할 도메인(예: 내 프론트엔드 주소)만 콕 집어서 지정하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}의 응답에 Access-Control-Allow-Origin: * 헤더가 붙어 있어서 아무 사이트나 내 서버 응답을 읽을 수 있대. 꼭 필요한 도메인만 허용하도록 CORS 설정을 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: value ? `access-control-allow-origin: ${value}` : "access-control-allow-origin 헤더가 없어요.",
  };
}

const ERROR_LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/Traceback/i, "Traceback"],
  [/Stack trace/i, "Stack trace"],
  [/at\s+[\w$<>.]+\s*\(/, "at 함수명(...) 형태의 스택"],
  [/\.php on line \d+/i, ".php on line N"],
  [/\bException\b/i, "Exception"],
];

function checkErrorPageLeak(ctx: DiagnosisContext): Check {
  // 정상 페이지의 인라인 스크립트/스타일 코드가 스택 패턴으로 오인되지 않도록 제외하고 본다.
  const text = (ctx.errorPageProbe?.body ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const matched = ERROR_LEAK_PATTERNS.find(([re]) => re.test(text));
  return {
    id: "error-page-leak",
    category: "보안",
    title: "에러 페이지 내부 정보 노출",
    status: matched ? "warning" : "pass",
    why: "없는 페이지나 오류가 났을 때 화면에 서버 코드 경로, 에러 종류, 스택 트레이스가 그대로 보이면 공격자에게 내 서버의 구조와 약점을 알려주는 셈이에요.",
    howToFix: "배포 환경에서 디버그 모드를 끄고, 사용자에게는 '페이지를 찾을 수 없어요' 같은 간단한 안내만 보여주는 전용 에러 페이지를 만드세요. 자세한 에러는 서버 로그에만 남기면 돼요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에서 없는 주소로 접속하면 에러 페이지에 서버 내부 정보(스택 트레이스, 에러 이름 등)가 보인대. 배포 환경에서 디버그 모드를 끄고 간단한 커스텀 404/에러 페이지를 보여주도록 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: !ctx.errorPageProbe
      ? "에러 페이지를 확인하지 못했어요."
      : matched
      ? `없는 주소의 응답(상태코드 ${ctx.errorPageProbe.status})에서 "${matched[1]}" 흔적이 보여요.`
      : `없는 주소의 응답(상태코드 ${ctx.errorPageProbe.status})에서 내부 정보 노출은 보이지 않았어요.`,
  };
}

function checkCharset(ctx: DiagnosisContext): Check {
  const metaCharset = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([\w-]+)/i.exec(ctx.body)?.[1] ?? null;
  const headerCharset = /charset\s*=\s*["']?([\w-]+)/i.exec(ctx.headers.get("content-type") ?? "")?.[1] ?? null;
  const declared = metaCharset || headerCharset;
  return {
    id: "charset",
    category: "기본 상태",
    title: "문자 인코딩(charset) 선언",
    status: declared ? "pass" : "warning",
    why: "문자 인코딩이 선언돼 있지 않으면 브라우저가 글자 규칙을 추측하다가 한글이 '�����'처럼 깨져 보일 수 있어요. 특히 오래된 브라우저나 일부 앱 내 브라우저에서 자주 생겨요.",
    howToFix: "HTML의 <head> 맨 위에 <meta charset=\"utf-8\"> 를 넣거나, 서버 응답의 Content-Type 헤더에 charset=utf-8 을 붙이세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에 문자 인코딩(charset) 선언이 없어서 한글이 깨질 위험이 있대. <head>에 <meta charset="utf-8">을 추가하거나 Content-Type 헤더에 charset=utf-8을 지정해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: metaCharset
      ? `meta charset: ${metaCharset}`
      : headerCharset
      ? `Content-Type 헤더 charset: ${headerCharset}`
      : "meta charset과 Content-Type charset 모두 없어요.",
  };
}

function checkStatusCode(ctx: DiagnosisContext): Check {
  const code = ctx.statusCode;
  let status: CheckStatus = "pass";
  if (code >= 400) status = "danger";
  else if (code >= 300) status = "warning";
  return {
    id: "status-code",
    category: "기본 상태",
    title: "최종 응답 상태 코드",
    status,
    why:
      status === "danger"
        ? "사이트가 오류 상태를 반환하고 있어요. 방문자가 페이지를 아예 볼 수 없을 수도 있어요."
        : status === "warning"
        ? "최종적으로 리다이렉트 상태에서 멈춰 있어요. 정상적으로 최종 페이지에 도달하지 못했을 수 있어요."
        : "정상적으로 페이지가 응답하고 있어요.",
    howToFix:
      status === "pass"
        ? "별도 조치가 필요 없어요."
        : "호스팅 대시보드에서 배포 로그와 에러 로그를 확인하고, 존재하지 않는 페이지라면 올바른 주소로 안내하거나 404 페이지를 정리하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}의 최종 응답 상태 코드가 ${code}야. 이 문제를 진단하고 정상적인 200 응답이 나오도록 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: `최종 상태 코드: ${code}`,
  };
}

function checkRedirectChain(ctx: DiagnosisContext): Check {
  const count = ctx.redirectChain.length;
  const status: CheckStatus = count > 3 ? "warning" : "pass";
  return {
    id: "redirect-chain",
    category: "기본 상태",
    title: "리다이렉트 횟수",
    status,
    why: "리다이렉트가 여러 번 반복되면 페이지가 뜨는 속도가 느려지고, 검색엔진이 페이지를 제대로 인식하지 못할 수도 있어요.",
    howToFix: "불필요한 중간 리다이렉트를 제거하고, 최종 주소로 한 번에 연결되도록 설정을 정리하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}가 최종 페이지에 도달하기까지 리다이렉트를 ${count}번 거쳐. 리다이렉트 횟수를 줄이고 한 번에 최종 주소로 연결되도록 설정을 점검해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: count > 0 ? `리다이렉트 ${count}회: ${ctx.redirectChain.map((h) => `${h.status}`).join(" → ")}` : "리다이렉트 없이 바로 응답했어요.",
  };
}

function checkTtfb(ctx: DiagnosisContext): Check {
  const ms = ctx.ttfbMs;
  let status: CheckStatus = "pass";
  if (ms > 3000) status = "danger";
  else if (ms > 1000) status = "warning";
  return {
    id: "ttfb",
    category: "기본 상태",
    title: "첫 응답 속도 (TTFB)",
    status,
    why: "첫 바이트가 늦게 도착하면 방문자가 흰 화면을 오래 보게 되고, 이탈률이 높아지며 검색엔진 순위에도 불리해요.",
    howToFix: "서버 위치가 방문자와 먼 지역인지 확인하고, 캐싱(CDN)을 적용하거나 서버 사양을 점검하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}의 첫 응답 시간(TTFB)이 ${ms}ms로 느린 편이야. 응답 속도를 개선할 수 있는 방법(캐싱, CDN, 서버 최적화 등)을 진단하고 적용해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: `TTFB: 약 ${ms}ms`,
  };
}

function checkGenerator(ctx: DiagnosisContext, generator: string | null): Check {
  return {
    id: "generator",
    category: "기술",
    title: "생성기(generator) 정보 노출",
    status: generator ? "warning" : "pass",
    why: "meta generator 태그는 어떤 프로그램(워드프레스, 웹사이트 빌더 등)의 몇 버전으로 만들어졌는지 알려줘요. 공격자가 이 정보로 알려진 취약점을 노려 공격할 수 있어요.",
    howToFix: "사용 중인 도구의 설정에서 generator meta 태그를 숨기는 옵션을 찾아 끄거나, 빌드 시 해당 태그를 제거하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}의 HTML에 meta generator 태그로 "${generator}"라는 버전 정보가 노출되고 있어. 이 태그를 제거하거나 숨겨줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: generator ? `generator: ${generator}` : "generator 태그가 발견되지 않았어요.",
  };
}

function checkJquery(ctx: DiagnosisContext, jqueryVersion: string | null): Check {
  if (!jqueryVersion) {
    return {
      id: "jquery",
      category: "기술",
      title: "jQuery 버전",
      status: "pass",
      why: "jQuery를 사용하지 않거나 버전을 확인할 수 없었어요.",
      howToFix: "별도 조치가 필요 없어요.",
      aiPrompt: "",
      details: "페이지에서 jQuery 파일이 감지되지 않았어요.",
    };
  }

  const isVulnerable = compareVersions(jqueryVersion, "3.5.0") < 0;
  const isOutdated = !isVulnerable && compareVersions(jqueryVersion, "3.7.0") < 0;
  const status: CheckStatus = isVulnerable ? "danger" : isOutdated ? "warning" : "pass";

  return {
    id: "jquery",
    category: "기술",
    title: "jQuery 버전",
    status,
    why: isVulnerable
      ? "jQuery 3.5.0 미만 버전에는 알려진 XSS(악성 스크립트 삽입) 취약점이 있어요. 공격자가 이를 악용해 사이트에 악성 코드를 심을 수 있어요."
      : isOutdated
      ? "사용 중인 jQuery가 최신 버전이 아니에요. 당장 위험하진 않지만, 최신 버전이 더 안전하고 버그도 적어요."
      : "최신에 가까운 안전한 버전을 사용하고 있어요.",
    howToFix: "페이지에서 불러오는 jQuery 파일 주소를 최신 버전(3.7.x)으로 교체하세요. CDN 링크의 버전 숫자만 바꾸면 되는 경우가 많아요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}가 jQuery ${jqueryVersion} 버전을 사용하고 있어서 ${isVulnerable ? "알려진 XSS 보안 취약점이 있대" : "버전이 오래됐대"}. jQuery를 최신 안정 버전(3.7.x)으로 업그레이드해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: `감지된 jQuery 버전: ${jqueryVersion}`,
  };
}

function checkServerHeader(ctx: DiagnosisContext, serverHeader: string | null): Check {
  const hasDetailedVersion = !!serverHeader && /\d+\.\d+/.test(serverHeader);
  return {
    id: "server-header",
    category: "기술",
    title: "서버 소프트웨어 버전 노출",
    status: hasDetailedVersion ? "warning" : "pass",
    why: "Server 응답 헤더에 소프트웨어 이름과 상세 버전이 함께 노출되면, 공격자가 그 버전에 알려진 취약점이 있는지 바로 찾아볼 수 있어요.",
    howToFix: "웹서버 설정에서 Server 헤더를 숨기거나(server_tokens off 등) 버전 정보 없이 이름만 표시하도록 바꾸세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}의 Server 응답 헤더에 "${serverHeader}"처럼 상세 버전 정보가 노출되고 있어. 버전 정보를 숨기도록 서버 설정을 고쳐줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: serverHeader ? `Server: ${serverHeader}` : "Server 헤더가 없거나 상세 버전이 노출되지 않았어요.",
  };
}

function checkTitle(ctx: DiagnosisContext, title: string | null): Check {
  let status: CheckStatus = "pass";
  if (!title) status = "danger";
  else if (title.length > 60) status = "warning";

  return {
    id: "title",
    category: "SEO",
    title: "페이지 제목(title)",
    status,
    why: !title
      ? "제목이 없으면 검색 결과와 브라우저 탭에 사이트 이름이 표시되지 않아, 방문자가 어떤 사이트인지 알기 어려워요."
      : status === "warning"
      ? "제목이 너무 길면 검색 결과에서 뒷부분이 '...'으로 잘려서 보여요."
      : "제목이 적절한 길이로 설정돼 있어요.",
    howToFix: "페이지의 <title> 태그에 사이트나 페이지를 잘 설명하는 30~60자 내외의 제목을 넣으세요.",
    aiPrompt: !title
      ? `내 웹사이트 ${ctx.inputUrl}에 <title> 태그가 없어. 사이트 내용을 잘 설명하는 30~60자 정도의 제목을 추가해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`
      : `내 웹사이트 ${ctx.inputUrl}의 <title> 태그가 ${title.length}자로 너무 길어서 검색 결과에서 잘려 보일 수 있대. 60자 이내로 핵심만 담아 줄여줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: title ? `"${title}" (${title.length}자)` : "title 태그가 발견되지 않았어요.",
  };
}

function checkMetaDescription(ctx: DiagnosisContext, description: string | null): Check {
  return {
    id: "meta-description",
    category: "SEO",
    title: "메타 설명(description)",
    status: description ? "pass" : "warning",
    why: "메타 설명이 없으면 검색 결과에 페이지 내용을 요약해서 보여줄 수 없어서, 사람들이 클릭하고 싶은 마음이 덜 들 수 있어요.",
    howToFix: "<meta name=\"description\" content=\"...\"> 태그에 페이지 내용을 요약한 100~160자 정도의 문장을 넣으세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에 meta description 태그가 없어. 검색 결과에 노출될 100~160자 정도의 설명 문구를 만들어서 추가해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: description ? `"${description}"` : "meta description 태그가 발견되지 않았어요.",
  };
}

function checkOgTags(ctx: DiagnosisContext, hasOgTitle: boolean): Check {
  return {
    id: "og-tags",
    category: "SEO",
    title: "오픈그래프(og) 태그",
    status: hasOgTitle ? "pass" : "warning",
    why: "og:title 같은 오픈그래프 태그가 없으면 카카오톡, 페이스북, 슬랙 등에 링크를 공유할 때 제목·이미지 없이 밋밋한 링크로만 보여요.",
    howToFix: "<meta property=\"og:title\">, <meta property=\"og:image\"> 등을 head에 추가하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에 오픈그래프(og:title 등) 태그가 없어서 카카오톡/페이스북 등에 링크를 공유할 때 미리보기가 제대로 안 보여. 기본적인 og:title, og:description, og:image 태그를 추가해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: hasOgTitle ? "og:title 태그가 있어요." : "og:title 태그가 발견되지 않았어요.",
  };
}

function checkViewport(ctx: DiagnosisContext, hasViewport: boolean): Check {
  return {
    id: "viewport",
    category: "SEO",
    title: "모바일 뷰포트 설정",
    status: hasViewport ? "pass" : "danger",
    why: "viewport 설정이 없으면 휴대폰으로 접속했을 때 화면이 PC 크기 그대로 축소되어 글씨가 아주 작게 보이거나 레이아웃이 깨질 수 있어요.",
    howToFix: "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> 태그를 head에 추가하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}에 meta viewport 태그가 없어서 모바일에서 화면이 깨져 보여. width=device-width, initial-scale=1 설정의 viewport 태그를 추가해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: hasViewport ? "viewport 태그가 설정돼 있어요." : "viewport 태그가 발견되지 않았어요.",
  };
}

function checkHtmlLang(ctx: DiagnosisContext, lang: string | null): Check {
  return {
    id: "html-lang",
    category: "SEO",
    title: "HTML 언어(lang) 속성",
    status: lang ? "pass" : "warning",
    why: "lang 속성이 없으면 검색엔진과 스크린리더가 페이지의 언어를 정확히 알기 어려워, 번역 제안이나 음성 안내가 부정확해질 수 있어요.",
    howToFix: "<html lang=\"ko\"> 처럼 페이지의 실제 언어 코드를 지정하세요.",
    aiPrompt: `내 웹사이트 ${ctx.inputUrl}의 <html> 태그에 lang 속성이 없어. 페이지 언어에 맞는 lang 속성(한국어라면 lang=\"ko\")을 추가해줘. 나는 비개발자니까 단계별로 쉽게 설명해줘.`,
    details: lang ? `lang="${lang}"` : "html lang 속성이 발견되지 않았어요.",
  };
}

export function extractTech(ctx: DiagnosisContext): TechInfo {
  const generator = findMetaContent(ctx.body, "name", "generator");
  const jquery = extractJquery(ctx.body);
  const server = ctx.headers.get("server");
  return { generator, jquery, server };
}

export function buildChecks(ctx: DiagnosisContext): Check[] {
  const title = extractTitle(ctx.body);
  const description = findMetaContent(ctx.body, "name", "description");
  const hasOgTitle = findMetaExists(ctx.body, "property", "og:title");
  const hasViewport = findMetaExists(ctx.body, "name", "viewport");
  const lang = extractHtmlLang(ctx.body);
  const tech = extractTech(ctx);

  return [
    // 보안
    checkHttps(ctx),
    checkHsts(ctx),
    checkCsp(ctx),
    checkXFrameOptions(ctx),
    checkXContentTypeOptions(ctx),
    checkReferrerPolicy(ctx),
    checkPermissionsPolicy(ctx),
    checkExposedEnv(ctx),
    checkExposedGit(ctx),
    checkExposedWpConfig(ctx),
    checkExposedDsStore(ctx),
    checkExposedServerStatus(ctx),
    checkMixedContent(ctx),
    checkSourcemapExposure(ctx),
    checkTlsExpiry(ctx),
    checkCookieFlags(ctx),
    checkCorsWildcard(ctx),
    checkErrorPageLeak(ctx),
    // 기본 상태
    checkStatusCode(ctx),
    checkRedirectChain(ctx),
    checkTtfb(ctx),
    checkCharset(ctx),
    // 기술
    checkGenerator(ctx, tech.generator),
    checkJquery(ctx, tech.jquery),
    checkServerHeader(ctx, tech.server),
    // SEO
    checkTitle(ctx, title),
    checkMetaDescription(ctx, description),
    checkOgTags(ctx, hasOgTitle),
    checkViewport(ctx, hasViewport),
    checkHtmlLang(ctx, lang),
  ];
}
