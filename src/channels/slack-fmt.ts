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
  // Horizontal rules → em-dash
  result = result.replace(/^---+$/gm, '———');
  return result;
}

/** Convert markdown to Slack mrkdwn. Only transforms what Slack doesn't handle natively. */
export function formatForSlack(text: string): string {
  return transformOutsideCodeBlocks(text, markdownToMrkdwn);
}
