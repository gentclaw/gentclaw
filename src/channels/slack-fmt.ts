/** Slack mrkdwn formatting — minimal transforms, code-block-aware. */

function transformOutsideCodeBlocks(text: string, fn: (s: string) => string): string {
  const parts = text.split(/(```[^\n]*\n[\s\S]*?```)/g);
  return parts.map((part, i) => i % 2 === 1 ? part : fn(part)).join('');
}

function markdownToMrkdwn(segment: string): string {
  let result = segment;
  // Headers → bold (strip nested **bold** inside headers)
  result = result.replace(/^#+\s+(.+)$/gm, (_m, content: string) =>
    `*${content.replace(/\*\*([^*]+)\*\*/g, '$1')}*`,
  );
  // **bold** → *bold* (Slack uses single asterisks)
  result = result.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  // ~~strikethrough~~ → ~strike~ (Slack uses single tildes)
  result = result.replace(/~~([^~]+)~~/g, '~$1~');
  // ![alt](url) → <url|alt> (images — Slack can't inline, but makes clickable)
  // URL group allows one level of balanced parens for Wikipedia-style URLs: /wiki/Foo_(bar)
  result = result.replace(/!\[([^\]]*)\]\(([^()\s]*(?:\([^)]*\)[^()\s]*)*)\)/g, '<$2|$1>');
  // [text](url) → <url|text> (Slack's native link format)
  result = result.replace(/\[([^\]]+)\]\(([^()\s]*(?:\([^)]*\)[^()\s]*)*)\)/g, '<$2|$1>');
  // * bullet at line start → • (prevents Slack bold collision)
  result = result.replace(/^\* /gm, '• ');
  // Horizontal rules → em-dash
  result = result.replace(/^---+$/gm, '———');
  return result;
}

/** Convert markdown to Slack mrkdwn. Only transforms what Slack doesn't handle natively. */
export function formatForSlack(text: string): string {
  return transformOutsideCodeBlocks(text, markdownToMrkdwn);
}
