import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getSettings } from './config.js';
import type { CustomCommand } from './types.js';

/** Built-in command names that cannot be overridden by custom commands or skills. */
const RESERVED = new Set([
  'help', 'status', 'model', 'agent', 'agents', 'default', 'reset', 'stop', 'reload',
]);

type CustomCmdResult = {
  message: string;
  agent?: string;
};

/** Safely interpolate $ARGUMENTS — escape exact-case token in user input to `\$ARGUMENTS` before substitution. Output is LLM prompt text; no downstream system interprets the backslash. */
function interpolateArgs(template: string, args: string): string {
  const safe = args.trim().replaceAll('$ARGUMENTS', '\\$ARGUMENTS');
  return template.replaceAll('$ARGUMENTS', safe);
}

/** Parse YAML-like frontmatter from SKILL.md content. */
export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta, body: content.trim() };
  const [, yamlBlock, body] = match;
  for (const line of yamlBlock!.split('\n')) {
    const kv = line.match(/^(\S+):\s*(.+)$/);
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }
  return { meta, body: body!.trim() };
}

/** Cached skills with mtime-based invalidation to avoid re-reading filesystem on every command */
let skillsCache: { skills: Record<string, CustomCommand>; mtime: number } | null = null;

/** Invalidate the skills cache (for testing). */
export function clearSkillsCache(): void { skillsCache = null; }

/** Discover skills from ~/.claude/skills/<name>/SKILL.md */
export function discoverSkills(): Record<string, CustomCommand> {
  const skillsDir = join(homedir(), '.claude', 'skills');

  // Check directory mtime for cache invalidation
  try {
    const mt = statSync(skillsDir).mtimeMs;
    if (skillsCache && skillsCache.mtime === mt) return skillsCache.skills;
  } catch { return {}; }

  const result: Record<string, CustomCommand> = {};
  let entries: string[];
  try { entries = readdirSync(skillsDir); } catch { return result; }

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry);
    try { if (!statSync(entryPath).isDirectory()) continue; } catch { continue; }

    const skillMd = join(entryPath, 'SKILL.md');
    if (!existsSync(skillMd)) continue;

    const name = entry.toLowerCase();
    if (RESERVED.has(name)) continue;

    try {
      const content = readFileSync(skillMd, 'utf8');
      const { meta, body } = parseFrontmatter(content);
      if (!body) continue;
      result[name] = {
        description: meta['description'] || `Skill: ${entry}`,
        prompt: body,
        agent: meta['agent'],
      };
    } catch { /* skip unreadable */ }
  }

  try { skillsCache = { skills: result, mtime: statSync(skillsDir).mtimeMs }; } catch { /* best-effort */ }
  return result;
}

/** Resolve a custom command by name. Settings commands win over skill files. */
export function resolveCustomCommand(
  name: string,
  args: string,
): CustomCmdResult | null {
  if (RESERVED.has(name)) return null;

  // Priority 1: settings.json commands
  const settings = getSettings();
  const cmds = settings.commands;
  const def = cmds?.[name];
  if (def) {
    const message = interpolateArgs(def.prompt, args);
    return { message, agent: def.agent };
  }

  // Priority 2: SKILL.md files
  const skills = discoverSkills();
  const skill = skills[name];
  if (skill) {
    const message = interpolateArgs(skill.prompt, args);
    return { message, agent: skill.agent };
  }

  return null;
}

/** List all valid custom commands from current settings. */
export function listCustomCommands(): Record<string, CustomCommand> {
  const settings = getSettings();
  const cmds = settings.commands;
  if (!cmds) return {};

  const valid: Record<string, CustomCommand> = {};
  for (const [name, def] of Object.entries(cmds)) {
    if (!RESERVED.has(name)) valid[name] = def;
  }
  return valid;
}

/** List discovered skills (excludes settings commands and reserved names). */
export function listSkills(): Record<string, CustomCommand> {
  const customNames = new Set(Object.keys(listCustomCommands()));
  const skills = discoverSkills();
  const result: Record<string, CustomCommand> = {};
  for (const [name, def] of Object.entries(skills)) {
    if (!customNames.has(name)) result[name] = def;
  }
  return result;
}
