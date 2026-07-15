// Идентичность для призовой механики. Сам ID читается только в Telegram Mini
// App; доверять ему на клиенте нельзя — сервер получает исходный initData и
// проверяет его HMAC подпись токеном бота (backend/worker.js).
export function telegramIdentity(tg) {
  try {
    const userId = String(tg?.initDataUnsafe?.user?.id || '');
    const initData = String(tg?.initData || '');
    if (!/^\d{3,20}$/.test(userId) || !initData) return null;
    return { userId, initData };
  } catch { return null; }
}
