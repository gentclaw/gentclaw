/** Agent memory — persistent knowledge across session resets */

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PATHS } from './paths.js';

export const MEMORY_FILE = 'memory.md';
export const SHARED_MEMORY_FILE = 'shared-memory.md';
export const MEMORY_MAX_LINES = 200;
export const ENTRY_MAX_LINES = 20;

const ENTRY_SEPARATOR_RE = /(?=^<!-- \d{4}-)/m;

// ─── Atomic write ────────────────────────────────────────────────

function atomicWriteText(filePath: string, data: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, filePath);
}

// ─── Entry-based trimming ────────────────────────────────────────

/** Split content into timestamped entries, drop oldest until under MEMORY_MAX_LINES */
function trimEntries(content: string): string {
  const entries = content.split(ENTRY_SEPARATOR_RE).filter(Boolean);
  let totalLines = entries.reduce((n, e) => n + e.split('\n').length, 0);

  while (totalLines > MEMORY_MAX_LINES && entries.length > 1) {
    const dropped = entries.shift()!;
    totalLines -= dropped.split('\n').length;
  }

  return entries.join('');
}

/** Cap a single entry at ENTRY_MAX_LINES to prevent budget exhaustion */
function capEntry(content: string): string {
  const lines = content.split('\n');
  if (lines.length <= ENTRY_MAX_LINES) return content;
  return lines.slice(0, ENTRY_MAX_LINES).join('\n') + '\n…(truncated)';
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

/** Extract memory tags from agent response, persist to files, return cleaned text. */
export function extractMemoryFromResponse(agentId: string, response: string): string {
  const agentMatches = [...response.matchAll(MEMORY_TAG_RE)];
  const sharedMatches = [...response.matchAll(SHARED_MEMORY_TAG_RE)];

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
