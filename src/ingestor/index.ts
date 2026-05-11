import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import { users, messages } from '../db/schema.js';
import { eq, sql, count } from 'drizzle-orm';

/**
 * Start the MTProto ingestor — reads all new messages from the target group.
 * Uses your personal Telegram account via gramjs.
 */
export async function startIngestor(db: DB, config: Config): Promise<void> {
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
  const result = db.select({ cnt: count() }).from(messages).get();
  if ((result?.cnt ?? 0) === 0) {
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

      // Look up the internal user id after upsert
      const userRow = db.select({ id: users.id })
        .from(users)
        .where(eq(users.tgUserId, tgUserId))
        .get();

      if (userRow) {
        db.insert(messages).values({
          tgMessageId: msg.id,
          userId: userRow.id,
          chatId: Number(chatId),
          text: msg.text,
          replyToMessageId: msg.replyToMsgId ?? null,
          reactionsCount: 0,
          timestamp: new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000),
        }).run();
      }

      console.log(`[ingestor] msg ${msg.id} from @${username}`);
    } catch (err) {
      console.error('[ingestor] Failed:', err);
    }
  });

  console.log('[ingestor] Running — press Ctrl+C to stop');
  await new Promise(() => {});
}

async function backfillMessages(
  db: DB,
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

      // Look up the internal user id after upsert
      const userRow = db.select({ id: users.id })
        .from(users)
        .where(eq(users.tgUserId, tgUserId))
        .get();

      if (userRow) {
        db.insert(messages).values({
          tgMessageId: msg.id,
          userId: userRow.id,
          chatId: Number(chatId),
          text: msg.text,
          replyToMessageId: msg.replyToMsgId ?? null,
          reactionsCount: 0,
          timestamp: new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000),
        }).run();
      }
    } catch {
      // Skip problematic messages
    }
  }

  console.log(`[ingestor] Backfilled ${msgs.length} messages`);
}

async function upsertUser(
  db: DB,
  tgUserId: number,
  username: string | null,
  displayName: string | null,
): Promise<void> {
  const existing = db.select({ id: users.id })
    .from(users)
    .where(eq(users.tgUserId, tgUserId))
    .get();

  if (!existing) {
    db.insert(users).values({
      tgUserId,
      username,
      displayName,
      messageCount: 1,
    }).run();
  } else {
    db.update(users)
      .set({
        username,
        displayName,
        messageCount: sql`${users.messageCount} + 1`,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.tgUserId, tgUserId))
      .run();
  }
}
