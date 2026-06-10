// Рандом-события рунета: редкие телеграфируемые гэги, которые не убивают.
// Каждое событие длится фиксированное время и запускает визуальный эффект.
import { CONFIG } from '../../config.js';
import { neonText, roundRectPath } from '../engine/render.js';
import { getSprite } from '../engine/assets.js';
import { STR, pick } from '../ui/strings.js';

const C = CONFIG.COLORS;

const GAG_TYPES = ['sber', 'rkn', 'ad', 'dns', 'ping', 'cookies', 'ip', 'scanner', 'notfound', 'tunnel', 'packet', 'hack'];
const VISUAL_TYPES = new Set(['dns', 'ping', 'cookies', 'ip', 'scanner', 'notfound', 'tunnel', 'packet']);
const DOMAINS = ['gos.portal', 'bank.off', 'cdn.lag', 'vpn.run', 'shop.sale', 'rkn.wall', 'dns.fail'];

export class EventManager {
  constructor() {
    this.active = null;  // { type, timer, label }
    this.cooldown = 0;
  }

  trySpawn(distance) {
    if (this.active || this.cooldown > 0 || distance < CONFIG.GAG_MIN_DIST) return;
    if (Math.random() > CONFIG.GAG_CHANCE * 16) return; // вызов ~раз в кадр при 60fps
    const type = pick(GAG_TYPES);
    const label = this._labelFor(type);
    const timer = type === 'ad' ? 3.5 : type === 'hack' ? 2.6 : VISUAL_TYPES.has(type) ? 2.2 : 1.8;
    this.active = { type, timer, label, age: 0 };
    this.cooldown = CONFIG.GAG_COOLDOWN;
  }

  _labelFor(type) {
    if (type === 'sber') return pick(STR.gagSber);
    if (type === 'rkn') return pick(STR.gagRkn);
    if (type === 'ad') return pick(STR.gagAd);
    if (type === 'hack') return pick(STR.gagHack);
    return pick(STR.gagVisual[type]);
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (!this.active) return null;
    this.active.age += dt;
    this.active.timer -= dt;
    if (this.active.timer <= 0) {
      const finished = this.active;
      this.active = null;
      return { type: finished.type, done: true };
    }
    return { type: this.active.type, timer: this.active.timer, age: this.active.age };
  }

  // speedMultiplier — замедление/заморозка фона при гэге
  speedMul() {
    if (!this.active) return 1;
    const t = this.active.type;
    if (t === 'sber') return 0.0;   // «лёг»: глитч-фриз
    if (t === 'rkn') return 0.35;   // slow-mo РКН
    return 1;                        // реклама не замедляет
  }

  // нужно ли тапнуть чтобы закрыть (тип 'ad')
  needsTap() { return this.active?.type === 'ad'; }

  // управление инвертировано (тип 'hack')
  controlsInverted() { return this.active?.type === 'hack'; }

  onTap() {
    if (this.active?.type === 'ad') {
      this.active.timer = 0; // закрываем
    }
  }

  draw(ctx, W, H, t) {
    if (!this.active) return;
    const { type, label, age } = this.active;
    const alpha = Math.min(1, age / 0.2) * Math.min(1, this.active.timer / 0.3);
    const spriteKey = type === 'sber' ? 'gags/sber_down'
      : type === 'rkn' ? 'gags/rkn_badge'
      : 'gags/ad_popup';
    const img = getSprite(spriteKey);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (type === 'sber') {
      // глитч-полосы по всему экрану
      for (let i = 0; i < 7; i++) {
        const gy = (i * H / 6 + t * 40) % H;
        ctx.fillStyle = i % 2 ? 'rgba(255,41,55,0.25)' : 'rgba(255,255,255,0.10)';
        ctx.fillRect(0, gy, W, 4 + i);
      }
      if (img) {
        const dw = Math.min(W * 0.84, 420);
        const dh = dw * (img.height / img.width);
        ctx.drawImage(img, W / 2 - dw / 2, H / 2 - dh / 2, dw, dh);
      } else {
        neonText(ctx, label, W / 2, H / 2, { color: C.white, size: 42, glow: 24 });
      }
    } else if (type === 'rkn') {
      // затемнение краёв + метка
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(255,41,55,0.35)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      if (img) {
        const dw = Math.min(W * 0.72, 360);
        const dh = dw * (img.height / img.width);
        ctx.drawImage(img, W / 2 - dw / 2, H * 0.18 - dh / 2, dw, dh);
      } else {
        neonText(ctx, label, W / 2, H * 0.2, { color: C.red, size: 26, glow: 20 });
      }
    } else if (type === 'ad') {
      // поп-ап «реклама» с крестиком
      const pw = Math.min(W * 0.76, 320), ph = 90;
      const bx = (W - pw) / 2, by = H * 0.25;
      if (img) {
        const dh = pw * (img.height / img.width);
        ctx.drawImage(img, bx, by, pw, dh);
        neonText(ctx, '[ ТАП ЧТОБЫ ЗАКРЫТЬ ]', W / 2, by + dh + 18, { color: C.red, size: 11, glow: 6 });
      } else {
        ctx.fillStyle = 'rgba(12,2,4,0.92)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(bx, by, pw, ph, 10) : ctx.rect(bx, by, pw, ph);
        ctx.fill();
        ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.shadowColor = C.red; ctx.shadowBlur = 16;
        ctx.stroke();
        neonText(ctx, label, bx + pw / 2, by + ph / 2 - 8, { color: '#fff', size: 18, glow: 8 });
        neonText(ctx, '[ ТАП ЧТОБЫ ЗАКРЫТЬ ]', bx + pw / 2, by + ph - 14, { color: C.red, size: 11, glow: 6 });
      }
    } else if (type === 'hack') {
      this._drawHack(ctx, W, H, t, label, alpha);
    } else {
      this._drawVisualGag(ctx, W, H, t, type, label, alpha, age);
    }
    ctx.restore();
  }

  _drawVisualGag(ctx, W, H, t, type, label, alpha, age) {
    if (type === 'dns') return this._drawDnsStorm(ctx, W, H, t, alpha);
    if (type === 'ping') return this._drawPingBall(ctx, W, H, t, label, alpha);
    if (type === 'cookies') return this._drawCookiePanel(ctx, W, H, t, alpha);
    if (type === 'ip') return this._drawIpTarget(ctx, W, H, t, label, alpha);
    if (type === 'scanner') return this._drawScanner(ctx, W, H, t, label, alpha);
    if (type === 'notfound') return this._drawNotFoundGate(ctx, W, H, t, label, alpha);
    if (type === 'tunnel') return this._drawTunnel(ctx, W, H, t, label, alpha);
    this._drawLostPacket(ctx, W, H, t, label, alpha, age);
  }

  _drawDnsStorm(ctx, W, H, t, alpha) {
    for (let i = 0; i < 18; i++) {
      const x = ((i * 91 + t * 120) % (W + 180)) - 90;
      const y = (i * 53 + t * (70 + i * 3)) % H;
      const text = DOMAINS[i % DOMAINS.length];
      neonText(ctx, text, x, y, {
        color: i % 3 === 0 ? C.data : C.white,
        size: 10 + (i % 4) * 2,
        glow: 8,
        weight: '800',
      });
    }
    neonText(ctx, 'DNS ШТОРМ', W / 2, H * 0.18, { color: C.data, size: 22, glow: 16 });
    ctx.globalAlpha = alpha * 0.22;
    ctx.fillStyle = C.data;
    for (let i = 0; i < 24; i++) ctx.fillRect((i * 47 + t * 180) % W, (i * 71) % H, 8, 2);
    ctx.globalAlpha = alpha;
  }

  _drawPingBall(ctx, W, H, t, label, alpha) {
    const x = W * 0.18 + Math.abs(Math.sin(t * 3.4)) * W * 0.64;
    const y = H * 0.24 + Math.abs(Math.cos(t * 4.1)) * H * 0.22;
    ctx.strokeStyle = 'rgba(22,224,255,0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(W * 0.16, H * 0.48);
    ctx.quadraticCurveTo(W / 2, H * 0.08, W * 0.84, H * 0.48);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = C.data; ctx.shadowBlur = 18;
    ctx.fillStyle = C.data;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    neonText(ctx, label, W / 2, H * 0.58, { color: C.white, size: 30, glow: 18 });
  }

  _drawCookiePanel(ctx, W, H, t, alpha) {
    const panelH = Math.min(128, H * 0.18);
    const y = H - panelH - 18 + Math.sin(t * 8) * 2;
    roundRectPath(ctx, 16, y, W - 32, panelH, 10);
    ctx.fillStyle = 'rgba(8,6,22,0.94)'; ctx.fill();
    ctx.strokeStyle = C.warn; ctx.shadowColor = C.warn; ctx.shadowBlur = 18; ctx.lineWidth = 2; ctx.stroke();
    neonText(ctx, 'ПРИМИТЕ COOKIES', W / 2, y + panelH * 0.28, { color: C.white, size: 18, glow: 10 });
    const bw = Math.min(180, W * 0.44);
    roundRectPath(ctx, W / 2 - bw / 2, y + panelH * 0.52, bw, 34, 8);
    ctx.fillStyle = C.warn; ctx.fill();
    neonText(ctx, 'ПРИНЯТЬ ВСЁ', W / 2, y + panelH * 0.52 + 17, { color: '#120600', size: 15, glow: 0 });
  }

  _drawIpTarget(ctx, W, H, t, label, alpha) {
    const cx = W * 0.5 + Math.sin(t * 2.7) * W * 0.12;
    const cy = H * 0.48 + Math.cos(t * 2.1) * H * 0.08;
    const r = Math.min(W, H) * (0.11 + Math.sin(t * 8) * 0.01);
    ctx.strokeStyle = C.danger; ctx.shadowColor = C.danger; ctx.shadowBlur = 20; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r * 1.4, cy); ctx.lineTo(cx + r * 1.4, cy); ctx.moveTo(cx, cy - r * 1.4); ctx.lineTo(cx, cy + r * 1.4); ctx.stroke();
    neonText(ctx, label, W / 2, H * 0.26, { color: C.danger, size: 24, glow: 18 });
  }

  _drawScanner(ctx, W, H, t, label, alpha) {
    const y = (t * 260) % H;
    const g = ctx.createLinearGradient(0, y - 40, 0, y + 40);
    g.addColorStop(0, 'rgba(22,224,255,0)');
    g.addColorStop(0.5, 'rgba(22,224,255,0.32)');
    g.addColorStop(1, 'rgba(22,224,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - 40, W, 80);
    ctx.strokeStyle = C.data; ctx.shadowColor = C.data; ctx.shadowBlur = 18; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    neonText(ctx, label, W / 2, H * 0.22, { color: C.white, size: 28, glow: 14 });
    neonText(ctx, 'КРОМЕ ИНТЕРНЕТА', W / 2, H * 0.22 + 34, { color: C.data, size: 12, glow: 8 });
  }

  _drawNotFoundGate(ctx, W, H, t, label, alpha) {
    const w = Math.min(W * 0.78, 380);
    const h = Math.min(H * 0.22, 150);
    const x = W / 2 - w / 2;
    const y = H * 0.34 + Math.sin(t * 7) * 3;
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(6,1,10,0.72)'; ctx.fill();
    ctx.strokeStyle = C.danger; ctx.shadowColor = C.danger; ctx.shadowBlur = 24; ctx.lineWidth = 3; ctx.stroke();
    neonText(ctx, label, W / 2, y + h / 2, { color: C.white, size: 38, glow: 18 });
  }

  _drawTunnel(ctx, W, H, t, label, alpha) {
    const cx = W / 2;
    const cy = H * 0.42;
    ctx.strokeStyle = C.data; ctx.shadowColor = C.data; ctx.shadowBlur = 18; ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const r = ((t * 90 + i * 34) % (Math.min(W, H) * 0.42)) + 20;
      ctx.globalAlpha = alpha * (1 - i / 12);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    neonText(ctx, label, W / 2, H * 0.2, { color: C.data, size: 24, glow: 18 });
  }

  _drawHack(ctx, W, H, t, label, alpha) {
    // мерцающие магента-полосы со сдвигом — «взлом управления»
    for (let i = 0; i < 9; i++) {
      const gy = (i * H / 8 + Math.sin(t * 6 + i) * 6) % H;
      const shift = Math.sin(t * 14 + i * 2) * 24;
      ctx.globalAlpha = alpha * 0.18;
      ctx.fillStyle = i % 2 ? C.nebula : C.data;
      ctx.fillRect(shift, gy, W, 3 + (i % 3));
    }
    ctx.globalAlpha = alpha;
    neonText(ctx, 'ВЗЛОМ УПРАВЛЕНИЯ', W / 2, H * 0.2, { color: C.nebula, size: 24, glow: 18 });
    neonText(ctx, label, W / 2, H * 0.2 + 30, { color: C.white, size: 14, glow: 10 });
  }

  _drawLostPacket(ctx, W, H, t, label, alpha, age) {
    const p = Math.min(1, age / 2.2);
    const x = W * (0.18 + p * 0.64);
    const y = H * (0.36 + Math.sin(p * Math.PI * 2) * 0.08);
    const s = 34 + Math.sin(t * 12) * 3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 2.5);
    ctx.fillStyle = 'rgba(255,47,61,0.24)';
    ctx.strokeStyle = C.danger; ctx.shadowColor = C.danger; ctx.shadowBlur = 18; ctx.lineWidth = 2;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    neonText(ctx, '404', 0, 0, { color: C.white, size: 12, glow: 8 });
    ctx.restore();
    neonText(ctx, label, W / 2, H * 0.64, { color: C.danger, size: 24, glow: 14 });
  }
}
