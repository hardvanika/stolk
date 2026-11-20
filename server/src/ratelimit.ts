import { HttpError } from './http.js';

/** Hard caps for Preguntar, so a stuck key, a loop or a curious friend can't run up the Claude bill. */
export interface AskLimits { perMinute: number; perDay: number }
export const DEFAULT_ASK_LIMITS: AskLimits = { perMinute: 6, perDay: 200 };

/**
 * Sliding-window counter kept in memory. Stölk has one user, so one counter is enough;
 * a restart resets it, which is fine: the Console spend limit is the real backstop.
 */
export class AskLimiter {
  private hits: number[] = [];
  constructor(private limits: AskLimits = DEFAULT_ASK_LIMITS, private now: () => Date = () => new Date()) {}

  /** Count one question, or throw a 429 the app shows as-is (with the O looking annoyed). */
  take() {
    const t = this.now().getTime();
    this.hits = this.hits.filter((h) => t - h < 86_400_000);
    const lastMinute = this.hits.filter((h) => t - h < 60_000);
    if (lastMinute.length >= this.limits.perMinute) {
      const wait = Math.max(1, Math.ceil((lastMinute[0] + 60_000 - t) / 1000));
      throw new HttpError(429, 'ask_rate_limited', `Vas muy rápido. Puedes hacer ${this.limits.perMinute} preguntas por minuto; espera ${wait} s.`, { emotion: 'angry', retryAfter: wait });
    }
    if (this.hits.length >= this.limits.perDay) {
      throw new HttpError(429, 'ask_daily_limit', `Ya has hecho ${this.limits.perDay} preguntas en las últimas 24 horas. Vuelve mañana.`, { emotion: 'angry' });
    }
    this.hits.push(t);
  }
}
