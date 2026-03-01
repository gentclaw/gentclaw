import { describe, it, expect } from 'vitest';
import { formatForSlack } from '../../src/channels/slack-fmt.js';

describe('formatForSlack', () => {
  it('converts **bold** to *bold*', () => {
    expect(formatForSlack('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts headers to bold', () => {
    expect(formatForSlack('# Main Header')).toBe('*Main Header*');
    expect(formatForSlack('## Sub Header')).toBe('*Sub Header*');
  });

  it('converts horizontal rules to em-dash', () => {
    expect(formatForSlack('Line 1\n---\nLine 2')).toBe('Line 1\n———\nLine 2');
  });

  it('preserves code blocks', () => {
    const codeBlock = '```\ncode\n```';
    expect(formatForSlack(codeBlock)).toBe(codeBlock);
  });

  it('strips nested bold inside headers', () => {
    expect(formatForSlack('# Header with **bold**')).toBe('*Header with bold*');
  });

  it('handles multiple bold sections', () => {
    expect(formatForSlack('**start** middle **end**')).toBe('*start* middle *end*');
  });

  it('handles empty string', () => {
    expect(formatForSlack('')).toBe('');
  });

  it('handles headers with special characters', () => {
    expect(formatForSlack('# Header with $pecial chars!')).toBe('*Header with $pecial chars!*');
  });

  it('preserves code block with markdown inside', () => {
    const text = 'before\n```\n**bold** # header\n---\n```\nafter';
    expect(formatForSlack(text)).toBe('before\n```\n**bold** # header\n---\n```\nafter');
  });

  it('preserves code block with language specifier', () => {
    const text = 'text\n```js\nconst x = **y**;\n```\nmore';
    expect(formatForSlack(text)).toBe('text\n```js\nconst x = **y**;\n```\nmore');
  });

  it('handles multiple code blocks with text between', () => {
    const text = '```\ncode1\n```\n**bold**\n```\ncode2\n```';
    expect(formatForSlack(text)).toBe('```\ncode1\n```\n*bold*\n```\ncode2\n```');
  });

  it('all-bold header produces clean output', () => {
    expect(formatForSlack('# **All Bold Header**')).toBe('*All Bold Header*');
  });

  it('header + bold paragraph on separate lines', () => {
    const text = '# Title\nThis is **important** text';
    expect(formatForSlack(text)).toBe('*Title*\nThis is *important* text');
  });

  it('passes through plain text unchanged', () => {
    expect(formatForSlack('just plain text')).toBe('just plain text');
  });

  it('passes through Slack-native formatting unchanged', () => {
    expect(formatForSlack('_italic_ ~strike~ `code`')).toBe('_italic_ ~strike~ `code`');
  });

  // --- Link transforms ---

  it('converts markdown links to Slack links', () => {
    expect(formatForSlack('See [docs](https://example.com) here'))
      .toBe('See <https://example.com|docs> here');
  });

  it('converts multiple links on one line', () => {
    expect(formatForSlack('[a](https://a.com) and [b](https://b.com)'))
      .toBe('<https://a.com|a> and <https://b.com|b>');
  });

  it('converts image links to Slack links', () => {
    expect(formatForSlack('![screenshot](https://img.com/shot.png)'))
      .toBe('<https://img.com/shot.png|screenshot>');
  });

  it('preserves links inside code blocks', () => {
    const text = '```\n[link](https://example.com)\n```';
    expect(formatForSlack(text)).toBe(text);
  });

  it('handles Wikipedia-style URLs with parentheses', () => {
    expect(formatForSlack('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))'))
      .toBe('<https://en.wikipedia.org/wiki/Foo_(bar)|Foo>');
  });

  // --- Strikethrough ---

  it('converts ~~strikethrough~~ to ~strike~', () => {
    expect(formatForSlack('This is ~~deleted~~ text')).toBe('This is ~deleted~ text');
  });

  it('preserves strikethrough inside code blocks', () => {
    const text = '```\n~~not strike~~\n```';
    expect(formatForSlack(text)).toBe(text);
  });

  // --- Asterisk bullet lists ---

  it('converts * bullet lists to • bullets', () => {
    const text = '* item one\n* item two\n* item three';
    expect(formatForSlack(text)).toBe('• item one\n• item two\n• item three');
  });

  it('does not convert * inside text (bold)', () => {
    expect(formatForSlack('This is **bold** text')).toBe('This is *bold* text');
  });

  it('preserves * bullets inside code blocks', () => {
    const text = '```\n* not a bullet\n```';
    expect(formatForSlack(text)).toBe(text);
  });

  it('handles mixed formatting: header + link + bold', () => {
    const text = '# **Getting Started**\nCheck the [docs](https://docs.com) for ~~old~~ info';
    expect(formatForSlack(text))
      .toBe('*Getting Started*\nCheck the <https://docs.com|docs> for ~old~ info');
  });
});
