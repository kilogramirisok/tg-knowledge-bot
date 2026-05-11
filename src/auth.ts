/**
 * Generate a Telegram MTProto session string.
 * Run: npm run auth
 *
 * You need:
 * 1. TELEGRAM_API_ID and TELEGRAM_API_HASH from https://my.telegram.org
 * 2. Your phone number registered with Telegram
 */
import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import * as readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    console.error('❌ Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first.');
    console.error('   Get them from https://my.telegram.org → API Development Tools');
    process.exit(1);
  }

  console.log('🔐 Telegram Session Generator\n');

  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {});

  await client.start({
    phoneNumber: async () => await ask('📱 Phone number (with country code): '),
    password: async () => await ask('🔒 2FA password (or press Enter if none): '),
    phoneCode: async () => await ask('📩 Verification code: '),
    onError: (err) => console.error('Auth error:', err),
  });

  const sessionString = client.session.save() as unknown as string;
  console.log('\n✅ Authentication successful!\n');
  console.log('Add this to your .env:');
  console.log(`\nTELEGRAM_SESSION=${sessionString}\n`);

  await client.disconnect();
  rl.close();
}

main().catch(console.error);
