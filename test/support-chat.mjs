import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createSupportChat } from '../backend/support-chat.mjs';

function assert(value, message) {
  if (!value) throw new Error(message);
}

const db = new DatabaseSync(':memory:');
const calls = [];
let nextMessageId = 100;
let clock = 1_800_000_000_000;
async function telegramApi(method, params) {
  const id = nextMessageId++;
  calls.push({ method, params, id });
  return { ok: true, result: { message_id: id } };
}

let support = createSupportChat({
  db,
  adminIds: new Set(['9001', '9002']),
  telegramApi,
  now: () => clock,
  logger: { warn() {} },
});

const participant = {
  message_id: 41,
  chat: { id: 123456, type: 'private' },
  from: { id: 123456, username: 'winner_one', first_name: 'Анна' },
  text: 'Когда приедет приставка?',
};

assert(support.rememberContact(participant), 'private participant must be remembered');
assert(support.resolveContact('@winner_one')?.chat_id === '123456', 'participant must resolve by username');
support.rememberContact({
  message_id: 40,
  chat: { id: 654321, type: 'private' },
  from: { id: 654321, username: 'winner_one', first_name: 'Борис' },
  text: '/start',
});
assert(support.resolveContact('@winner_one')?.chat_id === '654321', 'reassigned username must resolve to its current owner');
support.rememberContact(participant);
support.ensureContact('222222', { username: 'winner_one', firstName: 'Старый профиль' });
assert(support.resolveContact('@winner_one')?.chat_id === '123456',
  'historical profile data must not steal a username from its live Telegram owner');
assert(support.recentContacts().length === 0, 'ordinary bot commands/contacts must not appear in support inbox');
assert(await support.relayParticipant(participant), 'participant message must be handled');
assert(support.recentContacts()[0]?.chat_id === '123456', 'actual participant message must appear in support inbox');
assert(calls.filter((c) => c.method === 'copyMessage' && ['9001', '9002'].includes(String(c.params.chat_id))).length === 2,
  'message must be copied to every configured admin');
assert(calls.some((c) => c.method === 'sendMessage' && c.params.chat_id === '123456' && c.params.text.includes('передано организатору')),
  'participant must receive a first-contact acknowledgement');
assert(db.prepare('SELECT COUNT(*) AS n FROM support_routes').get().n === 4,
  'both header and copied message must be reply routes for each admin');

const beforeDuplicate = calls.length;
await support.relayParticipant(participant);
assert(calls.length === beforeDuplicate, 'completed participant delivery must be idempotent after a repeated update');

clock += 1000;
await support.relayParticipant({ ...participant, message_id: 42, text: 'Вот адрес' });
assert(calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === '123456' && c.params.text.includes('передано организатору')).length === 1,
  'welcome acknowledgement must not clutter every participant message');

const copiedForFirstAdmin = calls.find((c) => c.method === 'copyMessage' && c.params.chat_id === '9001');
assert(copiedForFirstAdmin, 'first admin copy is missing');

// Новый экземпляр имитирует перезапуск процесса: reply-маршрут обязан сохраниться.
support = createSupportChat({
  db,
  adminIds: new Set(['9001', '9002']),
  telegramApi,
  now: () => clock,
  logger: { warn() {} },
});
const adminReply = {
  message_id: 77,
  chat: { id: 9001, type: 'private' },
  from: { id: 9001 },
  reply_to_message: { message_id: copiedForFirstAdmin.id },
  text: 'Отправим завтра, пришлите адрес.',
};
assert(await support.relayAdminReply(adminReply), 'admin Telegram-reply must be routed after restart');
assert(calls.some((c) => c.method === 'copyMessage'
  && c.params.chat_id === '123456' && c.params.from_chat_id === '9001' && c.params.message_id === 77),
  'admin reply must be copied back to the participant');
const beforeRepeatedAdminReply = calls.length;
assert(await support.relayAdminReply(adminReply), 'repeated admin update must still be recognized');
assert(calls.length === beforeRepeatedAdminReply, 'completed admin reply must not be delivered twice');
assert(support.currentSession('9001')?.participantChatId === '123456', 'reply must activate a safe short-lived dialog');
const beforeReplyCommand = calls.length;
assert(!await support.relayAdminReply({ ...adminReply, message_id: 82, text: '/done' }),
  'admin slash-command with stale Reply context must not be relayed to participant');
assert(!await support.relayAdminReply({ ...adminReply, message_id: 83, text: '', caption: '/done', document: { file_id: 'x' } }),
  'admin command in a media caption must not be relayed to participant');
assert(calls.length === beforeReplyCommand, 'reply-context command must not trigger Telegram delivery');
const activeMessage = {
  message_id: 79,
  chat: { id: 9001, type: 'private' },
  from: { id: 9001 },
  text: 'Трек-номер пришлю вечером.',
};
assert(await support.relayActiveAdmin(activeMessage), 'ordinary admin message must use the active dialog');
assert(calls.some((c) => c.method === 'copyMessage' && c.params.chat_id === '123456' && c.params.message_id === 79),
  'active-dialog message must reach the selected participant');
assert(calls.some((c) => c.method === 'setMessageReaction' && c.params.message_id === 79),
  'active-dialog delivery should use a quiet check reaction instead of chat clutter');
assert(support.closeSession('9001'), 'admin must be able to close active dialog');
assert(!await support.relayActiveAdmin({ ...activeMessage, message_id: 80 }), 'closed dialog must not route ordinary messages');
support.openSession('9001', '123456');
clock += 31 * 60 * 1000;
assert(!support.currentSession('9001'), 'inactive dialog must expire before it can misroute a later message');

const failingSwitch = createSupportChat({
  db,
  adminIds: new Set(['9001']),
  telegramApi: async () => { throw new Error('participant blocked bot'); },
  now: () => clock,
  logger: { warn() {} },
});
failingSwitch.openSession('9001', '123456');
assert(await failingSwitch.relayAdminReply({ ...adminReply, message_id: 81 }), 'failed reply switch must still be handled');
assert(!failingSwitch.currentSession('9001'), 'failed reply switch must clear the previous active participant');

// Сбой служебной галочки не должен превращать успешную доставку в ошибку.
const confirmationCalls = [];
const supportWithBrokenConfirmation = createSupportChat({
  db,
  adminIds: new Set(['9001']),
  telegramApi: async (method, params) => {
    confirmationCalls.push({ method, params });
    if (method === 'sendMessage' && String(params.text || '').startsWith('✅ →')) throw new Error('confirmation unavailable');
    return { ok: true, result: { message_id: nextMessageId++ } };
  },
  now: () => clock,
  sleep: async () => {},
  logger: { warn() {} },
});
assert(await supportWithBrokenConfirmation.relayAdminReply({ ...adminReply, message_id: 78 }),
  'successful copy must stay handled when confirmation fails');
assert(confirmationCalls.some((c) => c.method === 'copyMessage' && c.params.chat_id === '123456'),
  'reply must be delivered before confirmation');
assert(!confirmationCalls.some((c) => String(c.params.text || '').startsWith('❌')),
  'confirmation failure must not report delivery failure');

const bootstrapDb = new DatabaseSync(':memory:');
const bootstrapSupport = createSupportChat({
  db: bootstrapDb,
  adminIds: new Set(),
  adminUsernames: new Set(['zdanovnik']),
  telegramApi,
  now: () => clock,
  logger: { warn() {} },
});
const zdanovnik = {
  message_id: 1,
  chat: { id: 888888, type: 'private' },
  from: { id: 888888, username: 'zdanovnik', first_name: 'Moderator' },
  text: '/start',
};
assert(bootstrapSupport.authorizeAdmin(zdanovnik), 'configured @zdanovnik must claim admin access on first private message');
assert(bootstrapSupport.isAdmin('888888'), 'claimed admin must be authorized by immutable chat id');
const restartedBootstrap = createSupportChat({
  db: bootstrapDb,
  adminIds: new Set(),
  adminUsernames: new Set(['zdanovnik']),
  telegramApi,
  now: () => clock,
  logger: { warn() {} },
});
assert(restartedBootstrap.authorizeAdmin({ ...zdanovnik, from: { ...zdanovnik.from, username: 'renamed_admin' } }),
  'admin claim must survive restart and username changes');
assert(!restartedBootstrap.authorizeAdmin({ ...zdanovnik, chat: { id: 999999, type: 'private' }, from: { id: 999999, username: 'zdanovnik' } }),
  'reassigned username must not transfer an existing admin claim');
const revokedBootstrap = createSupportChat({
  db: bootstrapDb,
  adminIds: new Set(),
  adminUsernames: new Set(),
  telegramApi,
  now: () => clock,
  logger: { warn() {} },
});
assert(!revokedBootstrap.isAdmin('888888'), 'removing bootstrap username from configuration must revoke its claimed access');
const callsBeforeClaimedRelay = calls.length;
await restartedBootstrap.relayParticipant({ ...participant, message_id: 44 });
assert(calls.slice(callsBeforeClaimedRelay).some((c) => c.method === 'copyMessage' && c.params.chat_id === '888888'),
  'username-bootstrapped admin must receive participant conversations');

// Временный Telegram 429/5xx повторяется внутри ограниченного retry-бюджета.
let retryAttempts = 0;
const retrySleeps = [];
const retrySupport = createSupportChat({
  db,
  adminIds: new Set(['9001']),
  telegramApi: async (method, params) => {
    retryAttempts++;
    if (retryAttempts === 1) {
      const error = new Error('Telegram 429');
      error.retryable = true;
      error.retryAfter = 30;
      throw error;
    }
    return { ok: true, result: { message_id: nextMessageId++ } };
  },
  now: () => clock,
  sleep: async (ms) => { retrySleeps.push(ms); },
  logger: { warn() {} },
});
assert(await retrySupport.relayParticipant({ ...participant, message_id: 43 }), 'temporary Telegram error must remain handled');
assert(retryAttempts >= 3 && retrySleeps.length === 1, 'temporary Telegram error must retry before giving up');
assert(retrySleeps[0] === 30_000, 'Telegram retry_after must not be shortened');

const ambiguousDb = new DatabaseSync(':memory:');
let ambiguousCopyAttempts = 0;
let ambiguousSleeps = 0;
const ambiguousSupport = createSupportChat({
  db: ambiguousDb,
  adminIds: new Set(['9001']),
  telegramApi: async (method) => {
    if (method === 'copyMessage') {
      ambiguousCopyAttempts++;
      const error = new Error('socket closed after request was accepted');
      error.retryable = true;
      throw error;
    }
    return { ok: true, result: { message_id: nextMessageId++ } };
  },
  now: () => clock,
  sleep: async () => { ambiguousSleeps++; },
  logger: { warn() {} },
});
await ambiguousSupport.relayParticipant({ ...participant, message_id: 45 });
assert(ambiguousCopyAttempts === 1 && ambiguousSleeps === 0,
  'non-idempotent copyMessage must not retry after an ambiguous timeout/5xx');

const beforeGroup = calls.length;
assert(!await support.relayParticipant({ ...participant, message_id: 90, chat: { id: -100123, type: 'supergroup' } }),
  'group messages must not enter private support');
assert(calls.length === beforeGroup, 'group message must not trigger Telegram API calls');

const rateDb = new DatabaseSync(':memory:');
const rateCalls = [];
const rateSupport = createSupportChat({
  db: rateDb,
  adminIds: new Set(['9001']),
  telegramApi: async (method, params) => {
    rateCalls.push({ method, params });
    return { ok: true, result: { message_id: nextMessageId++ } };
  },
  now: () => clock,
  sleep: async () => {},
  logger: { warn() {} },
});
for (let i = 0; i < 14; i++) await rateSupport.relayParticipant({ ...participant, message_id: 200 + i });
assert(rateCalls.filter((c) => c.method === 'copyMessage' && c.params.chat_id === '9001').length === 12,
  'one participant must not exhaust bot limits with an unbounded relay burst');
assert(rateCalls.filter((c) => String(c.params.text || '').includes('слишком много')).length === 1,
  'rate-limit notice must be sent once per window');

const retentionDb = new DatabaseSync(':memory:');
let retentionClock = clock;
const retentionSupport = createSupportChat({
  db: retentionDb,
  adminIds: new Set(['9001']),
  telegramApi,
  now: () => retentionClock,
  logger: { warn() {} },
});
retentionSupport.rememberContact(participant);
retentionClock += 367 * 24 * 60 * 60 * 1000;
retentionSupport.rememberContact({ ...participant, message_id: 500, chat: { id: 777777, type: 'private' } });
assert(!retentionSupport.resolveContact('123456'), 'inactive support contacts must be purged during long process uptime');

const routeColumns = db.prepare('PRAGMA table_info(support_routes)').all().map((row) => row.name);
assert(!routeColumns.includes('text') && !routeColumns.includes('caption'), 'support routing must not store message contents');

const serverSource = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
assert(/await supportChat\.relayAdminReply\(msg\)/.test(serverSource)
  && /await supportChat\.relayActiveAdmin\(msg\)/.test(serverSource)
  && /await supportChat\.relayParticipant\(msg\)/.test(serverSource),
  'production polling must wire both directions of support relay');
assert(/supportChat\.authorizeAdmin\(msg\)/.test(serverSource) && /BOT_ADMIN_USERNAMES/.test(serverSource),
  'production polling must safely bootstrap configured moderator usernames');
const adminCommandGuard = serverSource.indexOf('const adminCommandText');
const adminReplyRelay = serverSource.indexOf('await supportChat.relayAdminReply(msg)', adminCommandGuard);
assert(adminCommandGuard >= 0 && adminReplyRelay > adminCommandGuard,
  'admin slash-commands must be handled before Telegram Reply routing');
assert(/supportChat\.ensureContact\(recipient\.chatId/.test(serverSource)
  && /if \(!opened\) supportChat\.closeSession\(chatId\)/.test(serverSource),
  '/reply must switch to its recipient or clear the previous active dialog');
assert(/if \(!link\?\.chat_id && !allowUnknownId\) return null/.test(serverSource),
  '/chat must reject arbitrary numeric IDs that never contacted the bot');
assert(/WHERE last_support_at IS NOT NULL/.test(await readFile(new URL('../backend/support-chat.mjs', import.meta.url), 'utf8')),
  '/dialogs must include only real support messages');
assert(!/if \(!msg\?\.text \|\| !msg\.chat\?\.id\) continue/.test(serverSource),
  'production polling must not discard photos, documents and other non-text messages');
assert(serverSource.indexOf('const contact = supportChat.resolveContact(target)') < serverSource.indexOf('const row = qLinkByUsername.get'),
  'live support contact must take priority over a potentially stale Mini App username');

console.log('✓ Telegram support chat: multi-admin relay, persistent replies, privacy and group guard');
