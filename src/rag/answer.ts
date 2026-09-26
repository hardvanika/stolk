import type { Hit } from './retrieve';
import type { QueryPlan } from './plan';

export function describeHit(h: Hit): string {
  const who = [h.full_name, [h.role, h.company].filter(Boolean).join(' at ')].filter(Boolean).join(', ');
  const where = [h.event_name, h.place_name].filter(Boolean).join(' / ');
  const when = h.met_at.slice(0, 10);
  return `${who}. Met ${when}${where ? ` at ${where}` : ''}.${h.note ? ` Note: ${h.note}` : ''}`;
}

/** Grounded prompt: the model may only use these records. */
export function answerMessages(question: string, hits: Hit[]) {
  const records = hits.map((h, i) => `[${i + 1}] ${describeHit(h)}`).join('\n');
  return [
    {
      role: 'system' as const,
      content:
        'You answer questions about people the user met, using ONLY the numbered records. ' +
        'Cite records like [1]. If the records do not answer the question, say so. Be brief. ' +
        'Reply in the language of the question.',
    },
    { role: 'user' as const, content: `Records:\n${records || '(no records)'}\n\nQuestion: ${question}` },
  ];
}

/** Used when the chat model is not loaded: still useful, just not conversational. */
export function templateAnswer(plan: QueryPlan, hits: Hit[]): string {
  if (!hits.length) return 'No one matches that.';
  const scope = [plan.event && `at ${plan.event}`, plan.place && `at ${plan.place}`, plan.near_me && 'near here'].filter(Boolean).join(' ');
  return `${hits.length} ${hits.length === 1 ? 'person' : 'people'}${scope ? ' ' + scope : ''}:\n` +
    hits.map((h, i) => `[${i + 1}] ${describeHit(h)}`).join('\n');
}
