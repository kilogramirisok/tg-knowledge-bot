import type { DB } from '../db/index.js';
import { users, messages } from '../db/schema.js';
import chalk from 'chalk';

export async function seedTestData(db: DB): Promise<void> {
  console.log(chalk.cyan('🌱 Seeding test data...\n'));

  const testUsers = [
    { tgUserId: 100001, username: 'tax_expert_maria', displayName: 'Maria', reputationScore: 0.9 },
    { tgUserId: 100002, username: 'nomad_john', displayName: 'John', reputationScore: 0.6 },
    { tgUserId: 100003, username: 'abogado_carlos', displayName: 'Carlos', reputationScore: 0.85 },
    { tgUserId: 100004, username: 'newcomer_anna', displayName: 'Anna', reputationScore: 0.2 },
    { tgUserId: 100005, username: 'digital_sarah', displayName: 'Sarah', reputationScore: 0.7 },
    { tgUserId: 100006, username: 'guiri_mike', displayName: 'Mike', reputationScore: 0.5 },
    { tgUserId: 100007, username: 'freelance_lucia', displayName: 'Lucía', reputationScore: 0.75 },
    { tgUserId: 100008, username: 'crypto_dave', displayName: 'Dave', reputationScore: 0.3 },
  ];

  for (const u of testUsers) {
    db.insert(users).values({
      tgUserId: u.tgUserId,
      username: u.username,
      displayName: u.displayName,
      reputationScore: u.reputationScore,
      messageCount: 10 + Math.floor(Math.random() * 100),
      answersGiven: Math.floor(Math.random() * 20),
      reactionsReceived: Math.floor(Math.random() * 50),
    }).onConflictDoNothing({ target: users.tgUserId }).run();
  }
  console.log(chalk.green(`  ✓ Created ${testUsers.length} test users`));

  // Build tgUserId → internal id map
  const allUsers = db.select({ tgUserId: users.tgUserId, id: users.id }).from(users).all();
  const userIdMap = new Map(allUsers.map(u => [u.tgUserId, u.id]));

  const chatId = 1234567890;
  const now = Math.floor(Date.now() / 1000);
  const hour = 3600;

  const testMessages: Array<{ userId: number; text: string; hoursAgo: number; reactions: number }> = [
    // Beckham Law thread
    { userId: 100004, text: 'Hi everyone! I just moved to Barcelona. Someone told me about the Beckham Law — what is it and do I qualify?', hoursAgo: 72, reactions: 2 },
    { userId: 100001, text: 'The Beckham Law (Régimen Especial de Trabajadores Desplazados) allows qualifying expats to pay a flat 24% tax on Spanish-sourced income up to €600,000 instead of the progressive rates (up to 47%). You qualify if: (1) you haven\'t been a Spanish tax resident in the past 10 years, (2) your move to Spain is due to an employment contract or you\'re starting a business, (3) at least 85% of your income is from Spanish sources. You must elect it within 6 months of starting your Spanish employment via Modelo 149. Note: as of 2023 changes, if your income exceeds €600k, the excess is taxed at 47%.', hoursAgo: 71.5, reactions: 15 },
    { userId: 100003, text: 'Adding to Maria\'s excellent answer — also note that under Beckham Law you\'re exempt from wealth tax (Impuesto sobre el Patrimonio) and from the obligation to report foreign assets (Modelo 720) for the first year. However, you still need to file Modelo 100 (IRPF) annually. The regime lasts for the year you move plus 5 additional years, with a possible extension to 6 years under certain conditions.', hoursAgo: 71, reactions: 8 },
    // Autónomo thread
    { userId: 100005, text: 'How do I register as autónomo in Spain? I\'m a freelance developer moving to Madrid.', hoursAgo: 48, reactions: 3 },
    { userId: 100002, text: 'Go to hacienda.gob.es, fill out Modelo 036 or 037 (Declaración Censal). You\'ll need your NIE, a Spanish bank account, and the IAE epígrafe for your activity. For software development, use epígrafe 831.4. Register within 30 days of starting your activity. You\'ll also need to register with the Seguridad Social — the monthly cuota is currently around €230/month for new autónomos (tarifa plana for the first year). File VAT returns (Modelo 303) quarterly and income tax (Modelo 130) quarterly too.', hoursAgo: 47.5, reactions: 12 },
    { userId: 100007, text: 'Important addition: if you\'re a new autónomo, you qualify for the "tarifa plana" — a reduced monthly social security payment of about €80/month for the first year (instead of ~€230). This was recently extended and there are discounts in year 2 and 3 as well. Also, if your revenue is below €1,000/year, you can use the "rendimientos íntegros" estimation which simplifies your accounting significantly.', hoursAgo: 47, reactions: 6 },
    // NIE thread
    { userId: 100006, text: 'Can someone explain the difference between NIE and TIE? Do I need both?', hoursAgo: 36, reactions: 1 },
    { userId: 100003, text: 'NIE (Número de Identidad de Extranjero) is just a tax identification number — it\'s a number, not a document. You need it for basically everything: opening a bank account, signing a rental contract, getting internet, registering as autónomo. TIE (Tarjeta de Identidad de Extranjero) is the physical ID card for non-EU citizens. EU citizens get a "Certificado de Registro" (green paper) instead. As an EU citizen, you get your NIE at the same time as your registration certificate. Non-EU citizens get NIE as part of their visa/residence permit process, and TIE is issued separately.', hoursAgo: 35.5, reactions: 9 },
    // Double taxation
    { userId: 100008, text: 'I work remotely for a US company while living in Spain. Do I pay taxes in both countries?', hoursAgo: 24, reactions: 4 },
    { userId: 100001, text: 'Spain has a double taxation treaty with the US. If you\'re a Spanish tax resident (183+ days/year or Spain is your center of economic interest), you pay Spanish taxes on your worldwide income. The treaty prevents double taxation — you can credit US taxes paid against your Spanish tax liability. However, as a remote employee, your income is typically taxed where you physically perform the work (Spain). You\'ll file Form 1116 with the IRS to claim the foreign earned income exclusion or foreign tax credit. Get a Spanish tax advisor — this gets complicated with crypto, investments, etc.', hoursAgo: 23.5, reactions: 11 },
    // Noise
    { userId: 100006, text: 'thanks!', hoursAgo: 35, reactions: 0 },
    { userId: 100004, text: '👍', hoursAgo: 71, reactions: 0 },
    { userId: 100008, text: 'Anyone want to grab coffee in Gràcia this weekend?', hoursAgo: 12, reactions: 3 },
    // NLV thread
    { userId: 100005, text: 'What are the financial requirements for the non-lucrative visa in 2025?', hoursAgo: 18, reactions: 2 },
    { userId: 100003, text: 'For the NLV (Visado de Residencia No Lucrativa), you need to demonstrate sufficient financial means. The 2025 IPREM multiplier is 400% of the annual IPREM for the main applicant, which works out to roughly €28,800/year in savings or passive income. Each dependent adds 100% IPREM (≈€7,200). You also need private health insurance with coverage in Spain, a clean criminal record from countries where you\'ve lived in the past 5 years, and a medical certificate. The visa is initially granted for 1 year, then renewable for 2 years, then another 2 years. After 5 years you can apply for long-term residency.', hoursAgo: 17.5, reactions: 14 },
    // Banking thread
    { userId: 100002, text: 'What banking options are there for nomads? I heard N26 and Wise work well in Spain.', hoursAgo: 10, reactions: 1 },
    { userId: 100007, text: 'For banking as a foreigner in Spain: N26 works but has deposit limits and no business accounts. Wise is great for currency exchange but not a full bank. For autónomos, you really need a Spanish bank account — CaixaBank, Santander, or BBVA are common choices. Many digital banks now offer Spanish IBANs: Revolut Bank (European banking license), Bunq (Spanish IBAN available), and Openbank (Santander\'s digital bank). Note: for your Modelo 036 registration, some tax offices require a traditional Spanish bank. Revolut with a Spanish IBAN usually works.', hoursAgo: 9.5, reactions: 7 },
    // Short discussion (noise)
    { userId: 100004, text: 'Has anyone tried the digital nomad visa yet?', hoursAgo: 8, reactions: 0 },
    { userId: 100002, text: 'I applied 3 months ago, still waiting', hoursAgo: 7.5, reactions: 1 },
    { userId: 100005, text: 'Same, the processing time is ridiculous', hoursAgo: 7, reactions: 0 },
  ];

  let msgTgId = 1;
  for (const msg of testMessages) {
    const internalUserId = userIdMap.get(msg.userId) ?? null;
    const timestamp = Math.floor(now - msg.hoursAgo * hour);
    db.insert(messages).values({
      tgMessageId: msgTgId++,
      userId: internalUserId,
      chatId,
      text: msg.text,
      reactionsCount: msg.reactions,
      timestamp: new Date(timestamp * 1000),
    }).run();
  }

  console.log(chalk.green(`  ✓ Created ${testMessages.length} test messages`));
  const answers = testMessages.filter(m => m.reactions >= 6).length;
  const questions = testMessages.filter(m => m.text.includes('?') && m.text.length > 30).length;
  const noise = testMessages.filter(m => m.text.length < 20).length;
  console.log(chalk.gray(`    Questions: ~${questions}, Substantive answers: ~${answers}, Short/noise: ~${noise}`));
  console.log(chalk.green('\n✅ Seed complete. Run --mode=analyze to process.'));
}
