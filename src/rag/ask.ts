import type { Coords, SqlDb } from '../db/types';
import { heuristicPlan, mergePlans, normalizePlan, planPrompt, PLAN_SCHEMA, type QueryPlan } from './plan';
import { retrieve, type Hit } from './retrieve';
import { answerMessages, templateAnswer } from './answer';

export type LocalAI = {
  completeJson?: (prompt: string, schema: object) => Promise<unknown>;
  completeChat?: (m: ReturnType<typeof answerMessages>, onToken?: (t: string) => void) => Promise<string>;
  embedQuery?: (t: string) => Promise<number[]>;
};

export type AskResult = { plan: QueryPlan; hits: Hit[]; answer: string };

/** Question → filters → retrieval → grounded answer, all on device. Degrades gracefully without models. */
export async function ask(db: SqlDb, question: string, ai: LocalAI, here?: Coords | null, onToken?: (t: string) => void): Promise<AskResult> {
  const ctx = {
    today: new Date(),
    events: (await db.execute('SELECT name FROM events')).rows.map((r) => r.name as string),
    places: (await db.execute('SELECT name FROM places')).rows.map((r) => r.name as string),
  };
  const rules = heuristicPlan(question, ctx);
  let plan = rules;
  if (ai.completeJson) {
    try {
      plan = mergePlans(normalizePlan(await ai.completeJson(planPrompt(question, ctx), PLAN_SCHEMA), ctx), rules);
    } catch {
      plan = rules;
    }
  }
  let hits = await retrieve(db, plan, { here, embedQuery: ai.embedQuery });
  // If the model over-constrained the search, fall back to the rule-based plan.
  if (!hits.length && plan !== rules) {
    plan = rules;
    hits = await retrieve(db, plan, { here, embedQuery: ai.embedQuery });
  }
  const answer = ai.completeChat && hits.length
    ? await ai.completeChat(answerMessages(question, hits), onToken)
    : templateAnswer(plan, hits);
  return { plan, hits, answer };
}
