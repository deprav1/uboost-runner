// Двусторонний операторский чат поверх Telegram.
// В SQLite хранится только маршрутизация Telegram message_id -> chat_id;
// содержание сообщений остаётся в Telegram и не дублируется на сервере.

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function messageId(result) {
  const id = Number(result?.result?.message_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

import { randomBytes } from 'node:crypto';

const WINNER_CHAT_PREFIX = 'winner-chat:';

export function winnerChatCallbackData(token) {
  const value = String(token || '');
  return /^[0-9a-f]{32}$/.test(value) ? WINNER_CHAT_PREFIX + value : null;
}

export function winnerChatCallbackTarget(data) {
  const value = String(data || '');
  if (!value.startsWith(WINNER_CHAT_PREFIX)) return null;
  const token = value.slice(WINNER_CHAT_PREFIX.length);
  return /^[0-9a-f]{32}$/.test(token) ? token : null;
}

export function winnerChatList(rows, { label, ruleset } = {}) {
  const winners = Array.isArray(rows) ? rows.slice(0, 10) : [];
  const lines = winners.map((row, index) => {
    const alias = escapeHtml(row.alias || `Игрок ${index + 1}`);
    const contact = row.username
      ? `@${escapeHtml(row.username)}`
      : row.chatId ? 'Telegram подключён' : '⚠ чат с ботом не открыт';
    return `${index + 1}. <b>${alias}</b> — ${Number(row.distance) || 0} м · ${contact}`;
  });
  const buttons = winners.flatMap((row, index) => {
    const callbackData = String(row.callbackData || '');
    if (!winnerChatCallbackTarget(callbackData)) return [];
    const alias = String(row.alias || `Игрок ${index + 1}`).replace(/[\r\n]/g, ' ').slice(0, 28);
    return [[{ text: `✉️ ${index + 1}. ${alias}`, callback_data: callbackData }]];
  });
  const heading = `🏆 <b>Топ-10 по суммарной дистанции за ${escapeHtml(label || 'выбранный период')}</b>`
    + (ruleset ? `\nRuleset: <code>${escapeHtml(ruleset)}</code>` : '');
  const footer = buttons.length
    ? '\n\nНажми на участника — откроется отдельная карточка диалога на 30 минут. Пиши обычными сообщениями или отвечай Reply на карточку.\nПосле каждой отправки бот покажет адресата. Проверить: /who · завершить: /done'
    : '\n\nНикто из участников пока не открыл чат с ботом.';
  return {
    text: heading + '\n\n' + (lines.join('\n') || 'Подтверждённых результатов пока нет.') + footer,
    parse_mode: 'HTML',
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  };
}

export function createSupportChat({
  db,
  adminIds,
  adminUsernames,
  telegramApi,
  validateParticipantRoute = () => true,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
}) {
  const admins = new Set(Array.from(adminIds || [], String).filter(Boolean));
  const bootstrapAdminUsernames = new Set(
    Array.from(adminUsernames || [], (value) => String(value).replace(/^@/, '').toLowerCase()).filter(Boolean),
  );
  const retentionMs = 366 * 24 * 60 * 60 * 1000;
  const sessionTtlMs = 30 * 60 * 1000;
  const rateWindowMs = 60 * 1000;
  const rateLimit = 12;

  db.exec(`
    CREATE TABLE IF NOT EXISTS support_contacts (
      chat_id       TEXT PRIMARY KEY,
      username      TEXT,
      first_name    TEXT,
      last_seen_at  INTEGER NOT NULL,
      last_support_at INTEGER,
      welcomed_at   INTEGER
    );
    DROP INDEX IF EXISTS idx_support_contacts_username;
    CREATE INDEX IF NOT EXISTS idx_support_contacts_username_seen
      ON support_contacts(username COLLATE NOCASE, last_seen_at DESC) WHERE username IS NOT NULL AND username != '';
    CREATE TABLE IF NOT EXISTS support_routes (
      admin_chat_id         TEXT NOT NULL,
      admin_message_id      INTEGER NOT NULL,
      participant_chat_id   TEXT NOT NULL,
      participant_player_id TEXT,
      participant_message_id INTEGER,
      created_at            INTEGER NOT NULL,
      PRIMARY KEY (admin_chat_id, admin_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_support_routes_participant
      ON support_routes(participant_chat_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS support_deliveries (
      participant_chat_id    TEXT NOT NULL,
      participant_message_id INTEGER NOT NULL,
      admin_chat_id          TEXT NOT NULL,
      header_message_id      INTEGER,
      copied_message_id      INTEGER,
      created_at             INTEGER NOT NULL,
      PRIMARY KEY (participant_chat_id, participant_message_id, admin_chat_id)
    );
    CREATE TABLE IF NOT EXISTS support_limits (
      chat_id           TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      message_count     INTEGER NOT NULL,
      notified_at       INTEGER
    );
    CREATE TABLE IF NOT EXISTS support_admin_deliveries (
      admin_chat_id       TEXT NOT NULL,
      admin_message_id    INTEGER NOT NULL,
      participant_chat_id TEXT NOT NULL,
      delivered_at        INTEGER NOT NULL,
      PRIMARY KEY (admin_chat_id, admin_message_id)
    );
    CREATE TABLE IF NOT EXISTS support_admins (
      chat_id    TEXT PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
      claimed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_sessions (
      admin_chat_id       TEXT PRIMARY KEY,
      participant_chat_id TEXT NOT NULL,
      selected_at         INTEGER NOT NULL,
      expires_at          INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_winner_targets (
      token               TEXT PRIMARY KEY,
      player_id           TEXT NOT NULL,
      participant_chat_id TEXT NOT NULL,
      created_at          INTEGER NOT NULL,
      expires_at          INTEGER NOT NULL
    );
  `);

  try { db.exec('ALTER TABLE support_contacts ADD COLUMN last_support_at INTEGER'); } catch {}
  try { db.exec('ALTER TABLE support_routes ADD COLUMN participant_player_id TEXT'); } catch {}

  for (const row of db.prepare('SELECT chat_id AS chatId, username FROM support_admins').all()) {
    if (bootstrapAdminUsernames.has(String(row.username).toLowerCase())) admins.add(String(row.chatId));
  }

  const qRemember = db.prepare(`
    INSERT INTO support_contacts(chat_id, username, first_name, last_seen_at, last_support_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_seen_at = excluded.last_seen_at,
      last_support_at = COALESCE(excluded.last_support_at, support_contacts.last_support_at)
  `);
  const qEnsureContact = db.prepare(`
    INSERT INTO support_contacts(chat_id, username, first_name, last_seen_at, last_support_at)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(chat_id) DO UPDATE SET
      username = CASE WHEN excluded.username != '' THEN excluded.username ELSE support_contacts.username END,
      first_name = CASE WHEN excluded.first_name != '' THEN excluded.first_name ELSE support_contacts.first_name END,
      last_seen_at = excluded.last_seen_at
  `);
  const qContactByChat = db.prepare('SELECT chat_id, username, first_name, welcomed_at FROM support_contacts WHERE chat_id = ?');
  const qContactByUsername = db.prepare("SELECT chat_id, username, first_name, welcomed_at FROM support_contacts WHERE username = ? COLLATE NOCASE ORDER BY last_seen_at DESC LIMIT 1");
  const qReleaseUsername = db.prepare("UPDATE support_contacts SET username = '' WHERE username = ? COLLATE NOCASE AND chat_id != ?");
  const qWelcome = db.prepare('UPDATE support_contacts SET welcomed_at = ? WHERE chat_id = ? AND welcomed_at IS NULL');
  const qContactDelete = db.prepare('DELETE FROM support_contacts WHERE chat_id = ?');
  const qRoute = db.prepare(`
    INSERT OR REPLACE INTO support_routes(
      admin_chat_id, admin_message_id, participant_chat_id, participant_player_id, participant_message_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const qRouteGet = db.prepare(`
    SELECT participant_chat_id AS participantChatId, participant_player_id AS participantPlayerId
    FROM support_routes WHERE admin_chat_id = ? AND admin_message_id = ?
  `);
  const qDeliveryGet = db.prepare(`
    SELECT header_message_id AS headerMessageId, copied_message_id AS copiedMessageId
    FROM support_deliveries
    WHERE participant_chat_id = ? AND participant_message_id = ? AND admin_chat_id = ?
  `);
  const qDeliveryHeader = db.prepare(`
    INSERT INTO support_deliveries(
      participant_chat_id, participant_message_id, admin_chat_id, header_message_id, created_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(participant_chat_id, participant_message_id, admin_chat_id)
    DO UPDATE SET header_message_id = excluded.header_message_id
  `);
  const qDeliveryCopy = db.prepare(`
    UPDATE support_deliveries SET copied_message_id = ?
    WHERE participant_chat_id = ? AND participant_message_id = ? AND admin_chat_id = ?
  `);
  const qLimitGet = db.prepare('SELECT window_started_at AS windowStartedAt, message_count AS messageCount, notified_at AS notifiedAt FROM support_limits WHERE chat_id = ?');
  const qLimitSet = db.prepare(`
    INSERT INTO support_limits(chat_id, window_started_at, message_count, notified_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      message_count = excluded.message_count,
      notified_at = excluded.notified_at
  `);
  const qAdminDeliveryGet = db.prepare(`
    SELECT participant_chat_id AS participantChatId
    FROM support_admin_deliveries WHERE admin_chat_id = ? AND admin_message_id = ?
  `);
  const qAdminDeliveryMark = db.prepare(`
    INSERT OR IGNORE INTO support_admin_deliveries(
      admin_chat_id, admin_message_id, participant_chat_id, delivered_at
    ) VALUES (?, ?, ?, ?)
  `);
  const qAdminClaimByUsername = db.prepare('SELECT chat_id AS chatId FROM support_admins WHERE username = ? COLLATE NOCASE');
  const qAdminClaimInsert = db.prepare('INSERT INTO support_admins(chat_id, username, claimed_at) VALUES (?, ?, ?)');
  const qSessionGet = db.prepare(`
    SELECT participant_chat_id AS participantChatId, selected_at AS selectedAt, expires_at AS expiresAt
    FROM support_sessions WHERE admin_chat_id = ?
  `);
  const qSessionSet = db.prepare(`
    INSERT INTO support_sessions(admin_chat_id, participant_chat_id, selected_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(admin_chat_id) DO UPDATE SET
      participant_chat_id = excluded.participant_chat_id,
      selected_at = excluded.selected_at,
      expires_at = excluded.expires_at
  `);
  const qSessionDelete = db.prepare('DELETE FROM support_sessions WHERE admin_chat_id = ?');
  const qRecentContacts = db.prepare(`
    SELECT chat_id, username, first_name, last_seen_at
    FROM support_contacts
    WHERE last_support_at IS NOT NULL
    ORDER BY last_support_at DESC LIMIT ?
  `);
  const qWinnerTargetInsert = db.prepare(`
    INSERT INTO support_winner_targets(token, player_id, participant_chat_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const qWinnerTargetGet = db.prepare(`
    SELECT player_id AS playerId, participant_chat_id AS participantChatId, expires_at AS expiresAt
    FROM support_winner_targets WHERE token = ?
  `);

  // Технические контакты и маршруты не должны храниться бессрочно.
  const qCleanupRoutes = db.prepare('DELETE FROM support_routes WHERE created_at < ?');
  const qCleanupDeliveries = db.prepare('DELETE FROM support_deliveries WHERE created_at < ?');
  const qCleanupAdminDeliveries = db.prepare('DELETE FROM support_admin_deliveries WHERE delivered_at < ?');
  const qCleanupContacts = db.prepare('DELETE FROM support_contacts WHERE last_seen_at < ?');
  const qCleanupLimits = db.prepare('DELETE FROM support_limits WHERE window_started_at < ?');
  const qCleanupSessions = db.prepare('DELETE FROM support_sessions WHERE expires_at <= ?');
  const qCleanupWinnerTargets = db.prepare('DELETE FROM support_winner_targets WHERE expires_at <= ?');
  let lastCleanupAt = 0;
  function cleanup(force = false) {
    const stamp = now();
    if (!force && stamp - lastCleanupAt < 24 * 60 * 60 * 1000) return;
    const cutoff = stamp - retentionMs;
    qCleanupRoutes.run(cutoff);
    qCleanupDeliveries.run(cutoff);
    qCleanupAdminDeliveries.run(cutoff);
    qCleanupContacts.run(cutoff);
    qCleanupLimits.run(stamp - rateWindowMs);
    qCleanupSessions.run(stamp);
    qCleanupWinnerTargets.run(stamp);
    lastCleanupAt = stamp;
  }
  cleanup(true);

  async function telegramWithRetry(method, params) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await telegramApi(method, params);
      } catch (error) {
        lastError = error;
        // sendMessage/copyMessage не идемпотентны: после timeout/5xx Telegram
        // мог уже принять запрос, и автоматический повтор создаст дубль.
        // Безопасно повторяем только явный flood-control с retry_after;
        // setMessageReaction идемпотентен и допускает обычный transient retry.
        const retrySafe = Boolean(error?.retryAfter)
          || (method === 'setMessageReaction' && error?.retryable);
        if (!retrySafe) break;
        if (attempt < 2) {
          const delayMs = error.retryAfter ? error.retryAfter * 1000 : 300 * (2 ** attempt);
          // Telegram retry_after — обязательная нижняя граница, сокращать её
          // нельзя: иначе все попытки закончатся до снятия rate limit.
          await sleep(Math.max(100, delayMs));
        }
      }
    }
    throw lastError;
  }

  function authorizeAdmin(msg) {
    if (msg?.chat?.type !== 'private' || !msg.chat.id) return false;
    const chatId = String(msg.chat.id);
    if (admins.has(chatId)) return true;
    const username = String(msg.from?.username || '').replace(/^@/, '').toLowerCase();
    if (!username || !bootstrapAdminUsernames.has(username)) return false;

    const claimed = qAdminClaimByUsername.get(username);
    if (claimed) {
      if (String(claimed.chatId) !== chatId) return false;
    } else {
      try { qAdminClaimInsert.run(chatId, username, now()); }
      catch { return false; }
    }
    admins.add(chatId);
    qContactDelete.run(chatId);
    return true;
  }

  function isAdmin(value) {
    const chatId = typeof value === 'object' ? String(value?.chat?.id || '') : String(value || '');
    return admins.has(chatId);
  }

  function openSession(adminChatId, participantChatId) {
    const adminId = String(adminChatId || '');
    const participantId = String(participantChatId || '');
    if (!admins.has(adminId) || admins.has(participantId)) return null;
    const contact = qContactByChat.get(participantId);
    if (!contact) return null;
    const stamp = now();
    qSessionSet.run(adminId, participantId, stamp, stamp + sessionTtlMs);
    return contact;
  }

  function currentSession(adminChatId) {
    const adminId = String(adminChatId || '');
    if (!admins.has(adminId)) return null;
    const session = qSessionGet.get(adminId);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      qSessionDelete.run(adminId);
      return null;
    }
    return { ...session, contact: qContactByChat.get(session.participantChatId) || null };
  }

  function closeSession(adminChatId) {
    if (!admins.has(String(adminChatId || ''))) return false;
    return qSessionDelete.run(String(adminChatId)).changes > 0;
  }

  function recentContacts(limit = 8) {
    return qRecentContacts.all(Math.min(20, Math.max(1, Number(limit) || 8)))
      .filter((row) => !admins.has(String(row.chat_id)));
  }

  function rememberContact(msg, supportMessage = false) {
    cleanup();
    if (msg?.chat?.type !== 'private' || !msg.chat.id) return false;
    const chatId = String(msg.chat.id);
    if (admins.has(chatId)) return false;
    const username = String(msg.from?.username || '').replace(/^@/, '').slice(0, 64);
    if (username) qReleaseUsername.run(username, chatId);
    qRemember.run(
      chatId,
      username,
      String(msg.from?.first_name || '').slice(0, 128),
      now(),
      supportMessage ? now() : null,
    );
    return true;
  }

  function ensureContact(chatId, { firstName = '' } = {}) {
    const participantId = String(chatId || '');
    if (!participantId || admins.has(participantId)) return null;
    // Исторический telegram_links может содержать username прежнего владельца.
    // Username обновляет только живой входящий Telegram update в rememberContact().
    qEnsureContact.run(participantId, '', String(firstName || '').slice(0, 128), now());
    return qContactByChat.get(participantId) || null;
  }

  function resolveContact(target) {
    const value = String(target || '').trim();
    if (/^@?[A-Za-z0-9_]{3,}$/.test(value) && !/^@?\d+$/.test(value)) {
      return qContactByUsername.get(value.replace(/^@/, '')) || null;
    }
    if (/^\d{4,}$/.test(value)) return qContactByChat.get(value) || null;
    return null;
  }

  function saveRoute(adminChatId, adminMessageId, participantChatId, participantMessageId, participantPlayerId = null) {
    if (!adminMessageId) return;
    qRoute.run(
      String(adminChatId), adminMessageId, String(participantChatId), participantPlayerId || null,
      participantMessageId || null, now(),
    );
  }

  function registerAdminRoute(adminChatId, adminMessageId, participantChatId, participantPlayerId = null) {
    const adminId = String(adminChatId || '');
    const participantId = String(participantChatId || '');
    const id = Number(adminMessageId);
    if (!admins.has(adminId) || admins.has(participantId)
        || !Number.isSafeInteger(id) || id <= 0 || !qContactByChat.get(participantId)) return false;
    saveRoute(adminId, id, participantId, null, String(participantPlayerId || '') || null);
    return true;
  }

  function createWinnerTarget(playerId, participantChatId) {
    const player = String(playerId || '');
    const chatId = String(participantChatId || '');
    if (!player || player.length > 80 || !/^\d{4,20}$/.test(chatId)) return null;
    cleanup();
    const token = randomBytes(16).toString('hex');
    const stamp = now();
    qWinnerTargetInsert.run(token, player, chatId, stamp, stamp + retentionMs);
    return winnerChatCallbackData(token);
  }

  function resolveWinnerTarget(data) {
    const token = winnerChatCallbackTarget(data);
    if (!token) return null;
    const target = qWinnerTargetGet.get(token);
    if (!target || target.expiresAt <= now()) return null;
    return target;
  }

  function consumeRateLimit(chatId) {
    const stamp = now();
    const current = qLimitGet.get(chatId);
    if (!current || stamp - current.windowStartedAt >= rateWindowMs) {
      qLimitSet.run(chatId, stamp, 1, null);
      return { allowed: true, notify: false };
    }
    if (current.messageCount >= rateLimit) {
      const notify = !current.notifiedAt;
      qLimitSet.run(chatId, current.windowStartedAt, current.messageCount + 1, current.notifiedAt || stamp);
      return { allowed: false, notify };
    }
    qLimitSet.run(chatId, current.windowStartedAt, current.messageCount + 1, current.notifiedAt);
    return { allowed: true, notify: false };
  }

  async function relayParticipant(msg) {
    if (msg?.chat?.type !== 'private' || !msg.chat.id || !msg.message_id) return false;
    const participantChatId = String(msg.chat.id);
    if (admins.has(participantChatId)) return false;

    rememberContact(msg, true);
    if (!admins.size) {
      await telegramWithRetry('sendMessage', {
        chat_id: participantChatId,
        text: 'Сейчас операторский чат недоступен. Попробуй написать немного позже.',
      }).catch(() => {});
      return true;
    }
    if (Array.from(admins).every((adminChatId) =>
      qDeliveryGet.get(participantChatId, msg.message_id, adminChatId)?.copiedMessageId)) {
      return true;
    }
    const rate = consumeRateLimit(participantChatId);
    if (!rate.allowed) {
      if (rate.notify) {
        await telegramWithRetry('sendMessage', {
          chat_id: participantChatId,
          text: 'Сообщений слишком много. Подожди минуту — затем можно продолжить переписку.',
        }).catch(() => {});
      }
      return true;
    }

    const username = String(msg.from?.username || '').replace(/^@/, '');
    const firstName = String(msg.from?.first_name || 'Участник').slice(0, 128);
    const identity = username ? `@${escapeHtml(username)}` : `id:<code>${escapeHtml(participantChatId)}</code>`;
    const header = `💬 <b>${escapeHtml(firstName)}</b> · ${identity}\n`
      + `Reply откроет диалог автоматически. Или: <code>/chat ${escapeHtml(participantChatId)}</code>`;
    let delivered = 0;

    for (const adminChatId of admins) {
      try {
        let delivery = qDeliveryGet.get(participantChatId, msg.message_id, adminChatId);
        if (!delivery?.headerMessageId) {
          const heading = await telegramWithRetry('sendMessage', {
            chat_id: adminChatId,
            text: header,
            parse_mode: 'HTML',
          });
          const headingId = messageId(heading);
          if (!headingId) throw new Error('Telegram sendMessage returned no message_id');
          qDeliveryHeader.run(participantChatId, msg.message_id, adminChatId, headingId, now());
          delivery = { ...delivery, headerMessageId: headingId };
        }
        saveRoute(adminChatId, delivery.headerMessageId, participantChatId, msg.message_id);

        if (!delivery?.copiedMessageId) {
          const copied = await telegramWithRetry('copyMessage', {
            chat_id: adminChatId,
            from_chat_id: participantChatId,
            message_id: msg.message_id,
          });
          const copiedId = messageId(copied);
          if (!copiedId) throw new Error('Telegram copyMessage returned no message_id');
          qDeliveryCopy.run(copiedId, participantChatId, msg.message_id, adminChatId);
          delivery = { ...delivery, copiedMessageId: copiedId };
        }
        saveRoute(adminChatId, delivery.copiedMessageId, participantChatId, msg.message_id);
        delivered++;
      } catch (error) {
        logger.warn('support relay to admin failed:', error?.message || error);
      }
    }

    const contact = qContactByChat.get(participantChatId);
    if (delivered > 0 && !contact?.welcomed_at) {
      try {
        await telegramWithRetry('sendMessage', {
          chat_id: participantChatId,
          text: '✅ Сообщение передано организатору. Продолжай писать сюда — ответы придут в этот чат.',
        });
        qWelcome.run(now(), participantChatId);
      } catch (error) {
        logger.warn('support welcome failed:', error?.message || error);
      }
    } else if (delivered === 0) {
      await telegramWithRetry('sendMessage', {
        chat_id: participantChatId,
        text: 'Не удалось передать сообщение организатору. Попробуй ещё раз немного позже.',
      }).catch(() => {});
    }
    return true;
  }

  function contactName(chatId) {
    const contact = qContactByChat.get(String(chatId));
    if (contact?.username) return '@' + contact.username;
    if (contact?.first_name) return contact.first_name;
    return 'id:' + chatId;
  }

  async function deliverAdminMessage(msg, participantChatId, { announceSession = false, showRecipient = false } = {}) {
    const adminChatId = String(msg?.chat?.id || '');
    if (!admins.has(adminChatId) || !msg?.message_id) return false;
    const completed = qAdminDeliveryGet.get(adminChatId, msg.message_id);
    if (completed?.participantChatId) return true;

    try {
      await telegramWithRetry('copyMessage', {
        chat_id: participantChatId,
        from_chat_id: adminChatId,
        message_id: msg.message_id,
      });
      // Фиксируем доставку до служебной галочки: её сбой или рестарт процесса
      // не должны повторно отправить участнику уже полученный ответ.
      qAdminDeliveryMark.run(adminChatId, msg.message_id, participantChatId, now());
      openSession(adminChatId, participantChatId);
    } catch (error) {
      logger.warn('support reply failed:', error?.message || error);
      await telegramWithRetry('sendMessage', {
        chat_id: adminChatId,
        text: `❌ Не удалось доставить ответ участнику ${contactName(participantChatId)}: ${String(error?.message || 'ошибка Telegram').slice(0, 120)}`,
        reply_parameters: { message_id: msg.message_id },
      }).catch(() => {});
      return true;
    }

    // Первый ответ объясняет режим активного диалога. Дальше ставим реакцию,
    // чтобы служебные подтверждения не удваивали каждую реплику модератора.
    try {
      if (announceSession || showRecipient) {
        await telegramWithRetry('sendMessage', {
          chat_id: adminChatId,
          text: announceSession
            ? `✅ → ${contactName(participantChatId)} · диалог активен 30 минут`
            : `✅ → ${contactName(participantChatId)}`,
          reply_parameters: { message_id: msg.message_id },
        });
      } else {
        await telegramWithRetry('setMessageReaction', {
          chat_id: adminChatId,
          message_id: msg.message_id,
          reaction: [{ type: 'emoji', emoji: '✅' }],
          is_big: false,
        });
      }
    } catch (error) {
      logger.warn('support reply confirmation failed:', error?.message || error);
      if (!announceSession) {
        await telegramWithRetry('sendMessage', {
          chat_id: adminChatId,
          text: `✅ → ${contactName(participantChatId)}`,
          reply_parameters: { message_id: msg.message_id },
        }).catch(() => {});
      }
    }
    return true;
  }

  async function relayAdminReply(msg) {
    const adminChatId = String(msg?.chat?.id || '');
    if (!admins.has(adminChatId) || !msg?.message_id) return false;
    // Команды никогда не являются содержимым ответа участнику, даже если
    // Telegram-клиент сохранил Reply-контекст на старом обращении.
    if (String(msg.text || msg.caption || '').trim().startsWith('/')) return false;
    const repliedId = Number(msg.reply_to_message?.message_id);
    if (!Number.isSafeInteger(repliedId) || repliedId <= 0) return false;
    const route = qRouteGet.get(adminChatId, repliedId);
    if (!route?.participantChatId) return false;
    if (route.participantPlayerId
        && !validateParticipantRoute(route.participantPlayerId, route.participantChatId)) {
      await telegramWithRetry('sendMessage', {
        chat_id: adminChatId,
        text: '⚠️ Контакт победителя изменился. Открой актуальную карточку через /top10 — сообщение не отправлено.',
        reply_parameters: { message_id: msg.message_id },
      }).catch(() => {});
      return true;
    }
    // Повтор уже обработанного Telegram update не должен менять текущую сессию.
    if (qAdminDeliveryGet.get(adminChatId, msg.message_id)?.participantChatId) return true;
    const current = currentSession(adminChatId);
    const announceSession = current?.participantChatId !== route.participantChatId;
    // Попытка переключения всегда закрывает старый адресат до отправки. Если
    // Telegram вернёт ошибку, следующее обычное сообщение никуда не утечёт.
    closeSession(adminChatId);
    return deliverAdminMessage(msg, route.participantChatId, { announceSession });
  }

  async function relayActiveAdmin(msg) {
    const adminChatId = String(msg?.chat?.id || '');
    if (!admins.has(adminChatId) || !msg?.message_id || msg.reply_to_message) return false;
    const session = currentSession(adminChatId);
    if (!session?.participantChatId) return false;
    // В активном режиме Reply-контекста не видно, поэтому после каждой отправки
    // явно подписываем адресата. Для нескольких победителей это важнее тишины.
    return deliverAdminMessage(msg, session.participantChatId, { showRecipient: true });
  }

  return {
    authorizeAdmin,
    isAdmin,
    rememberContact,
    ensureContact,
    relayParticipant,
    relayAdminReply,
    relayActiveAdmin,
    resolveContact,
    registerAdminRoute,
    createWinnerTarget,
    resolveWinnerTarget,
    openSession,
    currentSession,
    closeSession,
    recentContacts,
  };
}
