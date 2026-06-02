// Provider-agnostic analytics. Replace the default stub via Analytics.use(adapter).
// Adapter contract: { track(event: string, props: object): void }
import { CONFIG } from '../../config.js';

let _adapter = {
  track(event, props) {
    if (typeof console !== 'undefined') console.debug('[analytics]', event, props);
  },
};

export const Analytics = {
  use(adapter) { _adapter = adapter; },

  gameStart() {
    _adapter.track('game_start', { ts: Date.now() });
  },

  gameOver({ score, distance, lives, captchas, geoblocks, ads, lags }) {
    _adapter.track('game_over', { score, distance, lives, captchas, geoblocks, ads, lags, ts: Date.now() });
  },

  share({ score, distance }) {
    _adapter.track('share', { score, distance, ts: Date.now() });
  },

  ctaClick({ score, distance }) {
    _adapter.track('cta_click', { score, distance, ts: Date.now() });
  },

  // Returns STORE_URL with UTM params appended for attribution.
  storeUrl(source = 'game', medium = 'cta', campaign = 'runner') {
    try {
      const u = new URL(CONFIG.STORE_URL);
      u.searchParams.set('utm_source', source);
      u.searchParams.set('utm_medium', medium);
      u.searchParams.set('utm_campaign', campaign);
      return u.toString();
    } catch {
      return CONFIG.STORE_URL;
    }
  },
};
