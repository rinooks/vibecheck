# VibeCheck — 바이브코딩 앱 진단기

바이브코딩(AI와 함께 코딩)으로 만든 웹 앱을 운영 중인데, 이게 보안적으로 괜찮은지,
느리진 않은지, 검색엔진에 제대로 노출되는지 잘 모르겠다면? VibeCheck에 URL만
입력하면 **보안 · 기본 상태 · 기술 · SEO** 네 영역을 자동으로 진단해서
비개발자도 이해할 수 있는 한국어로 결과를 보여줘요.

각 진단 항목마다 다음 세 가지를 함께 알려줘요.

- **이게 왜 문제예요?** — 전문용어 없이 쉬운 설명
- **이렇게 고치세요** — 비개발자도 따라 할 수 있는 단계별 요약
- **AI에게 이렇게 물어보세요** — 복사해서 ChatGPT, Claude 같은 AI 채팅에
  그대로 붙여넣으면 되는 완성된 프롬프트

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 을 열면 됩니다.

프로덕션 빌드 확인:

```bash
npm run build
npm run start
```

## API 설명

### `POST /api/diagnose`

**요청 본문**

```json
{ "url": "https://example.com" }
```

**응답 예시**

```json
{
  "inputUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "statusCode": 200,
  "redirectChain": [{ "url": "https://example.com", "status": 301 }],
  "ttfbMs": 182,
  "score": 76,
  "checks": [
    {
      "id": "https",
      "category": "보안",
      "title": "HTTPS 사용 여부",
      "status": "pass",
      "why": "...",
      "howToFix": "...",
      "aiPrompt": "...",
      "details": "https로 접속되고 있어요."
    }
  ],
  "tech": { "generator": null, "jquery": null, "server": "cloudflare" },
  "fetchedAt": "2026-01-01T00:00:00.000Z"
}
```

**진단 항목**

| 카테고리 | 항목 |
| --- | --- |
| 보안 | HTTPS 사용, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, `.env`/`.git`/`wp-config.php`/`.DS_Store`/`server-status` 노출, 혼합 콘텐츠, 소스맵(.map) 노출, SSL 인증서 만료일, 쿠키 보안 플래그, CORS `*` 허용, 에러 페이지 내부 정보 노출 |
| 기본 상태 | 최종 상태 코드, 리다이렉트 횟수, 첫 응답 속도(TTFB), 문자 인코딩(charset) 선언 |
| 기술 | generator 메타 태그 노출, jQuery 버전, Server 헤더 버전 노출 |
| SEO | title, meta description, 오픈그래프 태그, viewport, html lang |

점수는 100점에서 시작해 위험(danger) 항목마다 10점, 주의(warning) 항목마다
3점(경미한 항목은 2점)을 차감합니다. 90점 이상 "우수", 70점 이상 "양호",
50점 이상 "주의", 그 미만은 "위험" 등급을 매깁니다.

## SSRF(서버 요청 위조) 방어

사용자가 입력한 URL은 VibeCheck 서버가 대신 요청을 보내기 때문에, 내부망이나
클라우드 메타데이터 서버를 공격하는 통로로 악용될 수 있어요. 이를 막기 위해
`lib/ssrf.ts`, `lib/fetcher.ts`에서 다음을 적용했습니다.

1. **스킴 제한** — `http`, `https`만 허용하고, URL에 아이디/비밀번호(userinfo)가
   포함되거나 포트가 비정상이면 거부합니다.
2. **사설/특수 대역 차단** — `localhost`, `*.localhost`와 함께 `10/8`,
   `172.16/12`, `192.168/16`, `127/8`, `169.254/16`(클라우드 메타데이터
   `169.254.169.254` 포함), `0.0.0.0`, `::1`, `fc00::/7`, `fe80::/10` 등
   사설·특수 IP 대역을 차단합니다.
3. **DNS 리바인딩 방어** — 도메인의 모든 A/AAAA 레코드를 조회해서, 그중 하나라도
   사설 대역을 가리키면 요청을 거부합니다.
4. **리다이렉트 재검증** — 리다이렉트를 최대 5회까지만 따라가며, 매 홉마다 위
   검증을 처음부터 다시 수행합니다(`redirect: "manual"`로 직접 제어).
5. **타임아웃·용량 제한** — 요청은 10초 후 자동 중단되고, 응답 본문은 최대
   2MB까지만 읽습니다.
6. **노출 경로 체크 범위 제한** — `/.env` 등 노출 여부 확인은 사용자가 입력한
   URL과 **같은 호스트**에서만 수행합니다. 소스맵 확인도 같은 origin의
   스크립트만 대상으로 합니다.
7. **TLS 인증서 확인** — 인증서 만료일을 보려고 443 포트에 직접 접속할 때도
   먼저 `validateUrlFully`로 검증하고, 실제 접속 시점의 DNS 결과가 사설 대역이면
   연결을 끊습니다.

## 주의사항

VibeCheck는 **수동적(passive)** 진단만 수행해요. 사용자가 입력한 URL에
읽기 전용 GET 요청을 몇 번 보내서 응답 헤더와 HTML을 확인할 뿐, 취약점을
직접 공격하거나 인증을 시도하거나 무차별 대입 같은 공격적인 스캔은 절대
하지 않습니다. 진단 결과는 참고용이며, 실제 보안 점검은 전문가와 상의하세요.
