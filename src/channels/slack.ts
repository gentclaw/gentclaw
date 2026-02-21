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

const L = log('slack');

let app: App;
let botUserId: string | undefined;

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
): Promise<void> {
  if (!text || !userId) return;
  if (!isAllowed(userId)) return;

  // Strip bot mention from text if present
  let cleanText = text;
  if (botUserId) {
    cleanText = text.replace(new RegExp(`<@${botUserId}>\\s*`, 'g'), '').trim();
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

  // Process with per-session serialization
  await runSequential(sk, async () => {
    try {
      const response = await processMessage(msg);
      await reply(channelId, replyTs, response);
    } catch (err) {
      L.error('processing error', { sessionKey: sk, error: errMsg(err) });
      await reply(channelId, replyTs, `Error: ${errMsg(err)}`);
    }
  });
}

/** Start the Slack listener (Socket Mode). */
export async function startSlack(): Promise<void> {
  const settings = getSettings();
  const botToken = settings.channels?.slack?.botToken ?? process.env['SLACK_BOT_TOKEN'];
  const appToken = settings.channels?.slack?.appToken ?? process.env['SLACK_APP_TOKEN'];

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
  botUserId = authResult.user_id as string | undefined;
  L.info('authenticated', { botUserId });

  const onEvent = async ({ event }: { event: unknown }) => {
    const ev = event as Record<string, unknown>;
    if (ev['bot_id'] || ev['subtype']) return;
    try {
      await handleEvent(
        ev['user'] as string,
        (ev['text'] as string ?? '').trim(),
        ev['channel'] as string,
        ev['ts'] as string,
        ev['thread_ts'] as string | undefined,
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
    stopHeartbeat();
    app.stop().catch(() => {});
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
