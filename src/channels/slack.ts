import { App, LogLevel } from '@slack/bolt';
import { getSettings, hasAgents } from '../lib/config.js';
import { dispatchCommand } from '../lib/commands.js';
import { processMessage } from '../lib/pipeline.js';
import { runSequential } from '../lib/sequencer.js';
import { formatForSlack } from './slack-fmt.js';
import { splitMessage } from '../lib/text.js';
import { ensureDirectories } from '../lib/fs-utils.js';
import { initLog, log } from '../lib/log.js';
import { errMsg, ConfigError } from '../lib/errors.js';
import { startHeartbeat, stopHeartbeat } from '../lib/heartbeat.js';
import type { InboundMsg } from '../lib/types.js';

const MAX_FILE_SIZE = 100_000; // 100KB — skip large files

/** Resolve Slack token with settings → env fallback. */
function getSlackToken(key: 'botToken' | 'appToken', envKey: string): string | undefined {
  return getSettings().channels?.slack?.[key] ?? process.env[envKey];
}

const L = log('slack');
/** Status reaction names — mirrors claw's 4-phase lifecycle: received → working → done/error */
const REACT_RECEIVED = 'eyes';
const REACT_WORKING  = 'gear';
const REACT_DONE     = 'white_check_mark';
const REACT_ERROR    = 'x';
/** Hold done/error reaction visible before auto-removing to keep threads clean */
const REACT_HOLD_MS  = 5_000;

let app: App;
let botUserId: string | undefined;
let botMentionRe: RegExp | undefined;
/** Pending reaction-removal timers — cleared on shutdown to avoid post-stop API calls. */
const holdTimers = new Set<ReturnType<typeof setTimeout>>();

/** Fire-and-forget Slack reaction. Returns Promise for testability; callers may ignore. */
function reaction(method: 'add' | 'remove', channel: string, timestamp: string, name: string): Promise<void> {
  return app.client.reactions[method]({ channel, timestamp, name })
    .then(() => {})
    .catch((err: unknown) => { L.warn(`reaction.${method} failed`, { name, error: errMsg(err) }); });
}

/** Runtime type guard — validates object has expected SlackFile shape. */
function isSlackFile(f: unknown): f is { name?: string; size?: number; url_private?: string } {
  if (typeof f !== 'object' || f === null) return false;
  const o = f as Record<string, unknown>;
  if ('name' in o && typeof o.name !== 'string') return false;
  if ('size' in o && typeof o.size !== 'number') return false;
  if ('url_private' in o && typeof o.url_private !== 'string') return false;
  return true;
}

/** Runtime type guard — validates Slack event has required fields for processing. */
function isSlackEvent(event: unknown): event is {
  bot_id?: string;
  subtype?: string;
  user?: string;
  text?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  files?: unknown[];
} {
  if (!event || typeof event !== 'object') return false;
  const ev = event as Record<string, unknown>;
  return typeof ev.channel === 'string' && typeof ev.ts === 'string';
}

/** Download text content from Slack file attachments. Returns file contents appended to message. */
async function downloadAttachments(files: unknown[], botToken: string): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    if (!isSlackFile(f)) continue;
    const name = f.name || 'unnamed';
    const size = f.size || 0;
    const url = f.url_private;

    if (!url || size > MAX_FILE_SIZE) {
      parts.push(`[file: ${name} — skipped (${size > MAX_FILE_SIZE ? 'too large' : 'no url'})]`);
      continue;
    }

    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
      if (!resp.ok) {
        parts.push(`[file: ${name} — download failed: ${resp.status}]`);
        continue;
      }
      const text = await resp.text();
      parts.push(`--- file: ${name} ---\n${text}\n--- end file ---`);
    } catch (err) {
      parts.push(`[file: ${name} — error: ${errMsg(err)}]`);
    }
  }
  return parts.join('\n');
}

/** Compute session key from Slack thread context. */
function sessionKey(channelId: string, threadTs: string | undefined, messageTs: string): string {
  return `slack-${channelId}-${threadTs ?? messageTs}`;
}

/** Check if sender is in the allowlist (empty = allow all). */
function isAllowed(userId: string): boolean {
  const allowed = getSettings().allowedSenders;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(userId);
}

/** Post a reply to Slack, splitting long messages. */
async function reply(channelId: string, threadTs: string, text: string): Promise<void> {
  try {
    const formatted = formatForSlack(text);
    const chunks = splitMessage(formatted);
    for (const chunk of chunks) {
      await app.client.chat.postMessage({
        channel: channelId,
        text: chunk,
        thread_ts: threadTs,
      });
    }
    L.info('posted to slack', { channel: channelId, chunks: chunks.length });
  } catch (err) {
    L.error('reply failed', { channel: channelId, error: errMsg(err) });
  }
}

/** Handle a Slack event (message or app_mention). */
async function handleEvent(
  userId: string,
  text: string,
  channelId: string,
  ts: string,
  threadTs: string | undefined,
  files?: unknown[],
): Promise<void> {
  if (!userId) return;
  if (!isAllowed(userId)) return;

  // Strip bot mention from text if present
  let cleanText = text || '';
  if (botMentionRe) {
    cleanText = cleanText.replace(botMentionRe, '').trim();
  }

  // Download file attachments and append to message
  if (files && files.length > 0) {
    const botToken = getSlackToken('botToken', 'SLACK_BOT_TOKEN');
    if (!botToken) {
      L.warn('file download skipped — no botToken available');
    } else {
      const fileContent = await downloadAttachments(files, botToken);
      if (fileContent) cleanText = cleanText ? `${cleanText}\n\n${fileContent}` : fileContent;
    }
  }

  if (!cleanText) return;

  const sk = sessionKey(channelId, threadTs, ts);
  const replyTs = threadTs ?? ts;

  // Check for commands
  const cmdResult = dispatchCommand(cleanText, { sessionKey: sk, sender: userId });
  if (cmdResult) {
    if (cmdResult.skipInvoke) {
      await reply(channelId, replyTs, cmdResult.response);
      return;
    }
  }

  // Build inbound message — use interpolated prompt from custom commands
  const msg: InboundMsg = {
    sender: userId,
    message: cmdResult?.response ?? cleanText,
    timestamp: Date.now(),
    messageId: ts,
    sessionKey: sk,
    agent: cmdResult?.agent,
    channel: 'slack',
  };

  // Signal received
  void reaction('add', channelId, ts, REACT_RECEIVED);

  // Process with per-session serialization
  await runSequential(sk, async () => {
    // Transition: received → working
    void reaction('remove', channelId, ts, REACT_RECEIVED);
    void reaction('add', channelId, ts, REACT_WORKING);

    let outcome: typeof REACT_DONE | typeof REACT_ERROR = REACT_DONE;
    try {
      const response = await processMessage(msg);
      await reply(channelId, replyTs, response);
    } catch (err) {
      outcome = REACT_ERROR;
      L.error('processing error', { sessionKey: sk, error: errMsg(err) });
      await reply(channelId, replyTs, `Error: ${errMsg(err)}`);
    } finally {
      // Transition: working → outcome
      void reaction('remove', channelId, ts, REACT_WORKING);
      void reaction('add', channelId, ts, outcome);
      const t = setTimeout(() => { holdTimers.delete(t); void reaction('remove', channelId, ts, outcome); }, REACT_HOLD_MS);
      holdTimers.add(t);
    }
  });
}

/** Start the Slack listener (Socket Mode). */
export async function startSlack(): Promise<void> {
  const settings = getSettings();
  const botToken = getSlackToken('botToken', 'SLACK_BOT_TOKEN');
  const appToken = getSlackToken('appToken', 'SLACK_APP_TOKEN');

  if (!botToken || !appToken) {
    throw new ConfigError('Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN');
  }

  ensureDirectories();
  if (!hasAgents()) {
    throw new ConfigError('No agents configured. Run the setup wizard: node dist/setup.js');
  }
  initLog({ verbose: settings.logging?.verbose });

  app = new App({
    token: botToken,
    appToken,
    socketMode: true,
    logLevel: settings.devMode ? LogLevel.DEBUG : LogLevel.WARN,
  });

  // Resolve bot user ID for self-mention filtering
  const authResult = await app.client.auth.test({ token: botToken });
  botUserId = authResult.user_id;
  if (botUserId) botMentionRe = new RegExp(`<@${botUserId}>\\s*`, 'g');
  L.info('authenticated', { botUserId });

  const onEvent = async ({ event }: { event: unknown }) => {
    if (!isSlackEvent(event)) return;
    if (event.bot_id || event.subtype) return;
    try {
      await handleEvent(
        event.user ?? '',
        (event.text ?? '').trim(),
        event.channel,
        event.ts,
        event.thread_ts,
        event.files,
      );
    } catch (err) {
      L.error('event handler crash', { error: errMsg(err) });
    }
  };
  app.event('message', onEvent);
  app.event('app_mention', onEvent);

  await app.start();
  L.info('slack listener started');

  startHeartbeat();

  const shutdown = () => {
    for (const t of holdTimers) clearTimeout(t);
    holdTimers.clear();
    stopHeartbeat();
    app?.stop()?.catch(() => {});
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
