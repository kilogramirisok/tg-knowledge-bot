import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import type { AppDB } from '../db/index.js';
import type { Config } from '../config.js';

/**
 * Start the MTProto ingestor — reads all new messages from the target group.
 * Uses your personal Telegram account via gramjs.
 */
export async function startIngestor(db: AppDB, config: Config): Promise<void> {
  if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) {
    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH required. Get from https://my.telegram.org');
  }
  if (!config.TELEGRAM_SESSION) {
    throw new Error('TELEGRAM_SESSION required. Generate with: npm run auth');
  }

  const session = new StringSession(config.TELEGRAM_SESSION);
  const client = new TelegramClient(session, config.TELEGRAM_API_ID, config.TELEGRAM_API_HASH, {});

  await client.connect();
  console.log('[ingestor] Connected to Telegram via MTProto');

  // Resolve target group
  const dialog = await client.getEntity(config.TARGET_GROUP) as any;
  const chatId = BigInt(dialog.id.toString());
  console.log(`[ingestor] Listening to @${config.TARGET_GROUP} (id: ${chatId})`);

  // Backfill if DB is empty
  const count = (db.raw.prepare(`SELECT COUNT(*) as cnt FROM messages`).get() as { cnt: number }).cnt;
  if (count === 0) {
    console.log('[ingestor] DB empty — backfilling recent messages');
    await backfillMessages(db, client, chatId, 200);
  }

  // Listen for new messages
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg || !msg.text) return;

    try {
      const sender = await msg.getSender();
      const tgUserId = Number(sender?.id ?? 0);
      const username = sender && 'username' in sender ? (sender as any).username ?? null : null;
      const displayName = sender && 'firstName' in sender ? (sender as any).firstName ?? null : null;

      await upsertUser(db, tgUserId, username, displayName);

      db.raw.prepare(
        `INSERT OR IGNORE INTO messages (tg_message_id, user_id, chat_id, text, reply_to_message_id, reactions_count, timestamp, created_at)
         VALUES (?, (SELECT id FROM users WHERE tg_user_id = ?), ?, ?, ?, ?, ?, unixepoch())`,
      ).run(
        msg.id,
        tgUserId,
        chatId.toString(),
        msg.text,
        msg.replyToMsgId ?? null,
        0,
        msg.date ?? Math.floor(Date.now() / 1000),
      );

      console.log(`[ingestor] msg ${msg.id} from @${username}`);
    } catch (err) {
      console.error('[ingestor] Failed:', err);
    }
  });

  console.log('[ingestor] Running — press Ctrl+C to stop');
  await new Promise(() => {});
}

async function backfillMessages(
  db: AppDB,
  client: TelegramClient,
  chatId: bigint,
  limit: number,
): Promise<void> {
  const msgs = await client.getMessages(chatId as any, { limit });

  for (const msg of msgs) {
    if (!msg || !msg.text) continue;

    try {
      const sender = await msg.getSender();
      const tgUserId = Number(sender?.id ?? 0);
      const username = sender && 'username' in sender ? (sender as any).username ?? null : null;
      const displayName = sender && 'firstName' in sender ? (sender as any).firstName ?? null : null;

      await upsertUser(db, tgUserId, username, displayName);

      db.raw.prepare(
        `INSERT OR IGNORE INTO messages (tg_message_id, user_id, chat_id, text, reply_to_message_id, reactions_count, timestamp, created_at)
         VALUES (?, (SELECT id FROM users WHERE tg_user_id = ?), ?, ?, ?, ?, ?, unixepoch())`,
      ).run(
        msg.id,
        tgUserId,
        chatId.toString(),
        msg.text,
        msg.replyToMsgId ?? null,
        0,
        msg.date ?? Math.floor(Date.now() / 1000),
      );
    } catch {
      // Skip problematic messages
    }
  }

  console.log(`[ingestor] Backfilled ${msgs.length} messages`);
}

async function upsertUser(
  db: AppDB,
  tgUserId: number,
  username: string | null,
  displayName: string | null,
): Promise<void> {
  const existing = db.raw.prepare(`SELECT id FROM users WHERE tg_user_id = ?`).get(tgUserId);

  if (!existing) {
    db.raw.prepare(
      `INSERT INTO users (tg_user_id, username, display_name, message_count, created_at, updated_at)
       VALUES (?, ?, ?, 1, unixepoch(), unixepoch())`,
    ).run(tgUserId, username, displayName);
  } else {
    db.raw.prepare(
      `UPDATE users SET username = ?, display_name = ?, message_count = message_count + 1, last_active_at = unixepoch(), updated_at = unixepoch() WHERE tg_user_id = ?`,
    ).run(username, displayName, tgUserId);
  }
}
