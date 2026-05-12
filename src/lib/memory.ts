/** Agent memory — persistent knowledge across session resets */

import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './paths.js';
import { atomicWriteText } from './fs-utils.js';
import { MAX_MEMORY_TAGS_PER_RESPONSE } from './constants.js';

export const MEMORY_FILE = 'memory.md';
export const SHARED_MEMORY_FILE = 'shared-memory.md';
export const MEMORY_MAX_LINES = 200;
export const ENTRY_MAX_LINES = 20;
/** Max bytes per memory entry — prevents DOS via tag injection */
export const ENTRY_MAX_BYTES = 4096;

/** Matches timestamp comment boundaries (e.g. `<!-- 2026-03-05T... -->`) for entry splitting */
const ENTRY_SEPARATOR_RE = /(?=^<!-- \d{4}-)/m;

// ─── Entry-based trimming ────────────────────────────────────────

/** FIFO rotation: split content on timestamp boundaries, drop oldest entries until under MEMORY_MAX_LINES.
 * Preserves most recent context while bounding total memory budget. */
function trimEntries(content: string): string {
  const entries = content.split(ENTRY_SEPARATOR_RE).filter(Boolean);
  let totalLines = entries.reduce((n, e) => n + e.split('\n').length, 0);

  while (totalLines > MEMORY_MAX_LINES && entries.length > 1) {
    const dropped = entries.shift();
    totalLines -= (dropped ?? '').split('\n').length;
  }

  return entries.join('');
}

const TRUNCATION_SUFFIX = '\n…(truncated)';
const TRUNCATION_SUFFIX_BYTES = Buffer.byteLength(TRUNCATION_SUFFIX, 'utf8');

/** Cap a single entry at ENTRY_MAX_LINES / ENTRY_MAX_BYTES to prevent budget exhaustion.
 * Uses Buffer to slice at exact byte budget, then decodes back to string —
 * avoids splitting multi-byte UTF-8 chars (Buffer.toString drops incomplete trailing sequences). */
function capEntry(content: string): string {
  let capped = content;
  if (Buffer.byteLength(capped, 'utf8') > ENTRY_MAX_BYTES) {
    const budget = ENTRY_MAX_BYTES - TRUNCATION_SUFFIX_BYTES;
    capped = Buffer.from(capped, 'utf8').subarray(0, budget).toString('utf8');
    capped += TRUNCATION_SUFFIX;
  }
  const lines = capped.split('\n');
  if (lines.length <= ENTRY_MAX_LINES) return capped;
  return lines.slice(0, ENTRY_MAX_LINES).join('\n') + TRUNCATION_SUFFIX;
}

// ─── Core read/append/clear ──────────────────────────────────────

export function readMemoryFile(dir: string, filename: string): string {
  try {
    return readFileSync(join(dir, filename), 'utf8');
  } catch {
    return '';
  }
}

export function appendMemoryFile(dir: string, filename: string, content: string): void {
  const filePath = join(dir, filename);
  const capped = capEntry(content.trim());
  const entry = `<!-- ${new Date().toISOString()} -->\n${capped}\n`;

  let existing = '';
  try { existing = readFileSync(filePath, 'utf8'); } catch { /* new file */ }

  const combined = trimEntries(existing + entry);
  atomicWriteText(filePath, combined);
}

function clearMemoryFile(dir: string, filename: string): void {
  try { unlinkSync(join(dir, filename)); } catch { /* no-op if missing */ }
}

// ─── Per-agent memory ────────────────────────────────────────────

function agentMemoryDir(agentId: string): string {
  return join(PATHS.memory, agentId);
}

export function readAgentMemory(agentId: string): string {
  return readMemoryFile(agentMemoryDir(agentId), MEMORY_FILE);
}

export function appendAgentMemory(agentId: string, content: string): void {
  appendMemoryFile(agentMemoryDir(agentId), MEMORY_FILE, content);
}

export function clearAgentMemory(agentId: string): void {
  clearMemoryFile(agentMemoryDir(agentId), MEMORY_FILE);
}

// ─── Shared memory ───────────────────────────────────────────────

export function readSharedMemory(): string {
  return readMemoryFile(PATHS.memory, SHARED_MEMORY_FILE);
}

export function appendSharedMemory(content: string): void {
  appendMemoryFile(PATHS.memory, SHARED_MEMORY_FILE, content);
}

export function clearSharedMemory(): void {
  clearMemoryFile(PATHS.memory, SHARED_MEMORY_FILE);
}

// ─── Prompt building ─────────────────────────────────────────────

/** Build system prompt with memory context injected */
export function buildMemoryPrompt(
  agentMemory: string, sharedMemory: string, systemPrompt?: string,
): string {
  const parts: string[] = [];

  if (sharedMemory.trim()) {
    parts.push(`<shared-memory>\n${sharedMemory.trim()}\n</shared-memory>`);
  }
  if (agentMemory.trim()) {
    parts.push(`<agent-memory>\n${agentMemory.trim()}\n</agent-memory>`);
  }

  parts.push(
    'To save a private memory, include <memory>content</memory> in your response.',
    'To save a memory visible to all agents, include <shared-memory>content</shared-memory> in your response.',
    'Memory tags will be stripped before delivery.',
  );

  if (systemPrompt) parts.push(systemPrompt);
  return parts.join('\n\n');
}

// ─── Tag extraction ──────────────────────────────────────────────

const MEMORY_TAG_RE = /<memory>([\s\S]*?)<\/memory>/gi;
const SHARED_MEMORY_TAG_RE = /<shared-memory>([\s\S]*?)<\/shared-memory>/gi;

/** Strip all memory tags from text */
export function stripMemoryTags(text: string): string {
  return text
    .replace(SHARED_MEMORY_TAG_RE, '')
    .replace(MEMORY_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract memory tags from agent response, persist to files, return cleaned text.
 *  Honours at most MAX_MEMORY_TAGS_PER_RESPONSE of each kind — a single chatty reply
 *  must not be able to flood memory storage. Excess tags are still stripped from the visible reply. */
export function extractMemoryFromResponse(agentId: string, response: string): string {
  const agentMatches = [...response.matchAll(MEMORY_TAG_RE)].slice(0, MAX_MEMORY_TAGS_PER_RESPONSE);
  const sharedMatches = [...response.matchAll(SHARED_MEMORY_TAG_RE)].slice(0, MAX_MEMORY_TAGS_PER_RESPONSE);

  if (agentMatches.length === 0 && sharedMatches.length === 0) {
    return response;
  }

  for (const match of agentMatches) {
    const content = match[1].trim();
    if (content) appendAgentMemory(agentId, content);
  }
  for (const match of sharedMatches) {
    const content = match[1].trim();
    if (content) appendSharedMemory(content);
  }

  return stripMemoryTags(response);
}
