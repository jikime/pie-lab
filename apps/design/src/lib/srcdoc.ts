// srcdoc.ts — open-design runtime/srcdoc.ts buildSrcdoc()의 최소 추출.
// MVP는 단일 self-contained HTML 문서(외부 자산 인라인/CDN)이므로 baseHref
// 주입이나 edit-mode 브리지는 제외한다(02-architecture 1절 매핑).
//
// 에이전트가 완성된 <!doctype html> 전체 문서를 쓰도록 시스템 프롬프트에서
// 강제하므로, 받은 HTML을 그대로 iframe srcDoc에 넣는 것으로 충분하다.
// 다만 매우 드물게 부분 HTML이 오면 최소 문서로 감싼다.

export function buildSrcdoc(html: string): string {
  const trimmed = html.trimStart();
  const looksLikeDocument =
    /^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);

  if (looksLikeDocument) {
    return html;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
${html}
</body>
</html>`;
}
