// The tools Stölk offers to Claude (Claude desktop or Claude Code) over MCP.
// Every tool goes through the same Router handlers as the HTTP API, so validation and data shapes stay in one place.
import type { DB } from '../db.js';
import { HttpError, type Router } from '../http.js';
import { fold, todayIso } from '../util.js';

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (args: any) => Promise<unknown>;
}

/** Thrown for a tool call Claude can fix itself (bad id, missing field). Shown to Claude as a tool error. */
export class ToolError extends Error {}

/** Calls one Router route in-process, as if it came over HTTP. */
export async function callRoute(router: Router, method: string, path: string, body?: unknown): Promise<any> {
  const url = new URL(path, 'http://stolk.local');
  const m = router.match(method, url.pathname);
  if (m === null || m === 'method') throw new Error(`No route for ${method} ${url.pathname}`);
  try {
    return await m.route.handler({ params: m.params, query: url.searchParams, body: body ?? {}, host: '' });
  } catch (e) {
    if (e instanceof HttpError) throw new ToolError(e.message);
    throw e;
  }
}

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', minimum: 1, description });
const date = (description: string) => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description });
const tags = { type: 'array', items: { type: 'string' }, description: 'Short labels, for example "inversor" or "Madrid Tech".' };

const CONTACT_FIELDS = {
  name: str('Full name as the person gave it.'),
  role: str('Job title.'),
  company: str('Company or organisation.'),
  email: str('Email address.'),
  phone: str('Phone number, with country prefix if known.'),
  telegram: str('Telegram username.'),
  linkedin: str('LinkedIn profile URL.'),
  web: str('Personal or company website.'),
  notes: str('Free text about the person.'),
  tags,
};
const CONTACT_KEYS = Object.keys(CONTACT_FIELDS);
const CHANNELS = ['reunion', 'llamada', 'email', 'mensaje', 'evento'];
const DEFAULT_PROJECT = 'Pendientes';

const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const brief = (c: any) => ({
  id: c.id, name: c.name, role: c.role || undefined, company: c.company || undefined,
  email: c.email || undefined, phone: c.phone || undefined, tags: c.tags?.length ? c.tags : undefined,
  lastContact: c.lastContact ?? undefined,
});
function need(v: unknown, what: string): asserts v {
  if (v === undefined || v === null || v === '') throw new ToolError(`Falta ${what}`);
}

export function buildTools(router: Router, db: DB, now: () => Date = () => new Date()): ToolDef[] {
  const call = (m: string, p: string, b?: unknown) => callRoute(router, m, p, b);

  async function projectFor(args: { projectId?: number; project?: string }): Promise<any> {
    if (args.projectId) return call('GET', `/projects/${args.projectId}`);
    const title = (args.project ?? '').trim() || DEFAULT_PROJECT;
    const all: any[] = await call('GET', '/projects');
    return all.find((p) => fold(p.title) === fold(title)) ?? call('POST', '/projects', { title });
  }
  const contactName = (cid: number | null) =>
    cid ? ((db.prepare('SELECT name FROM contacts WHERE id = ?').get(cid) as any)?.name ?? null) : null;

  return [
    {
      name: 'search_contacts',
      title: 'Buscar personas',
      description:
        'Search the people in Stölk by name, company, role, tag, email or notes (accent and case insensitive). ' +
        'Use it before add_contact to find out whether the person is already saved. Without a query it lists everyone, most recently contacted first.',
      inputSchema: { type: 'object', properties: { query: str('Text to search for.'), limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } } },
      annotations: { readOnlyHint: true },
      run: async ({ query = '', limit = 20 }) => {
        const rows: any[] = await call('GET', `/contacts?q=${encodeURIComponent(query)}`);
        return { total: rows.length, contacts: rows.slice(0, limit).map(brief) };
      },
    },
    {
      name: 'get_contact',
      title: 'Ver persona',
      description: 'Everything Stölk knows about one person: details, notes, history of interactions, events, projects, tasks and relations.',
      inputSchema: { type: 'object', properties: { id: int('Contact id from search_contacts.') }, required: ['id'] },
      annotations: { readOnlyHint: true },
      run: async ({ id }) => {
        need(id, 'el id');
        const c = await call('GET', `/contacts/${id}`);
        const tasks: any[] = await call('GET', `/tasks?cid=${id}`);
        return { ...c, tasks };
      },
    },
    {
      name: 'add_contact',
      title: 'Guardar persona',
      description:
        'Save a new person in Stölk. Only use details the user said or shared in this conversation; never look people up elsewhere. ' +
        'If someone with the same email, phone or name already exists, nothing is created and the matches come back: ' +
        'then use update_contact on the right one, or call again with allowDuplicate=true if it really is a different person.',
      inputSchema: {
        type: 'object',
        properties: { ...CONTACT_FIELDS, allowDuplicate: { type: 'boolean', default: false, description: 'Create even if a similar person exists.' } },
        required: ['name'],
      },
      run: async (args) => {
        need(args.name?.trim?.(), 'el nombre');
        if (!args.allowDuplicate) {
          const q = new URLSearchParams(Object.entries({ email: args.email, phone: args.phone, name: args.name }).filter(([, v]) => v) as [string, string][]);
          const matches: any[] = (await call('GET', `/contacts/match?${q}`)).filter((m: any) => m.score >= 0.9);
          if (matches.length) {
            return {
              created: false,
              reason: 'Ya hay una persona parecida en Stölk.',
              matches: matches.map((m) => ({ ...brief(m.contact), matchedOn: m.matchedOn })),
            };
          }
        }
        const contact = await call('POST', '/contacts', pick(args, CONTACT_KEYS));
        return { created: true, contact: brief(contact) };
      },
    },
    {
      name: 'update_contact',
      title: 'Actualizar persona',
      description:
        'Change details of a saved person. Fields you pass replace the old value; fields you leave out stay as they are. ' +
        'Use addNote to append a dated line to their notes and addTags to add labels without losing the existing ones.',
      inputSchema: {
        type: 'object',
        properties: {
          id: int('Contact id.'),
          ...CONTACT_FIELDS,
          addNote: str('A line to append to the notes, dated today.'),
          addTags: { ...tags, description: 'Labels to add to the existing ones.' },
        },
        required: ['id'],
      },
      run: async (args) => {
        need(args.id, 'el id');
        const patch: any = pick(args, CONTACT_KEYS);
        if (args.addNote || args.addTags?.length) {
          const cur = await call('GET', `/contacts/${args.id}`);
          if (args.addNote) {
            const base = (patch.notes ?? cur.notes ?? '').trimEnd();
            patch.notes = `${base}${base ? '\n' : ''}${todayIso(now())}: ${String(args.addNote).trim()}`;
          }
          if (args.addTags?.length) patch.tags = [...(patch.tags ?? cur.tags), ...args.addTags];
        }
        const contact = await call('PATCH', `/contacts/${args.id}`, patch);
        return { updated: true, contact: { ...brief(contact), notes: contact.notes } };
      },
    },
    {
      name: 'log_interaction',
      title: 'Anotar conversación',
      description:
        "Add an entry to a person's history: a meeting, call, email, message or event where the user talked with them, with a short summary of what was said. " +
        'Set followUp to a date when the user should get back to them.',
      inputSchema: {
        type: 'object',
        properties: {
          contactId: int('Contact id.'),
          text: str('What was talked about, in one or two sentences, in the language the user writes in.'),
          channel: { type: 'string', enum: CHANNELS, default: 'reunion', description: 'reunion = in person, llamada = call, mensaje = chat or SMS.' },
          date: date('When it happened, YYYY-MM-DD. Defaults to today.'),
          followUp: date('Date to follow up, YYYY-MM-DD.'),
        },
        required: ['contactId', 'text'],
      },
      run: async ({ contactId, text, channel = 'reunion', date, followUp }) => {
        need(contactId, 'el contactId');
        need(text?.trim?.(), 'el texto');
        const body: any = { cid: contactId, date: date || todayIso(now()), ch: channel, text: text.trim() };
        if (followUp) body.follow = followUp;
        const interaction = await call('POST', '/interactions', body);
        return { saved: true, contact: contactName(contactId), interaction };
      },
    },
    {
      name: 'add_task',
      title: 'Añadir tarea',
      description:
        `Add a to-do to a project in Stölk, optionally tied to a person and a due date. ` +
        `Give the project by name (it is created if it does not exist) or by id. Without a project it goes to "${DEFAULT_PROJECT}".`,
      inputSchema: {
        type: 'object',
        properties: {
          text: str('What to do, starting with a verb.'),
          contactId: int('The person the task is about, if any.'),
          project: str('Project name.'),
          projectId: int('Project id, instead of the name.'),
          due: date('Due date, YYYY-MM-DD.'),
        },
        required: ['text'],
      },
      run: async ({ text, contactId, project, projectId, due }) => {
        need(text?.trim?.(), 'el texto');
        const p = await projectFor({ project, projectId });
        const body: any = { text: text.trim() };
        if (contactId) body.cid = contactId;
        if (due) body.due = due;
        const task = await call('POST', `/projects/${p.id}/tasks`, body);
        if (contactId && !p.people.some((x: any) => x.cid === contactId)) await call('PUT', `/projects/${p.id}/people/${contactId}`, {});
        return { saved: true, project: { id: p.id, title: p.title }, contact: contactName(contactId ?? null), task };
      },
    },
    {
      name: 'list_tasks',
      title: 'Ver tareas',
      description: 'List tasks, pending ones first by due date. Filter by status or person.',
      inputSchema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['pendiente', 'enviado', 'hecho'] }, contactId: int('Only tasks about this person.') },
      },
      annotations: { readOnlyHint: true },
      run: async ({ status, contactId }) => {
        const q = new URLSearchParams();
        if (status) q.set('st', status);
        if (contactId) q.set('cid', String(contactId));
        const tasks: any[] = await call('GET', `/tasks?${q}`);
        const titles = new Map((db.prepare('SELECT id, title FROM projects').all() as any[]).map((p) => [p.id, p.title]));
        return tasks.map((t) => ({ ...t, project: titles.get(t.projectId), contact: contactName(t.cid) }));
      },
    },
    {
      name: 'complete_task',
      title: 'Marcar tarea',
      description: 'Change the status of a task: hecho when done, enviado when the user is waiting on someone else.',
      inputSchema: { type: 'object', properties: { id: int('Task id.'), status: { type: 'string', enum: ['pendiente', 'enviado', 'hecho'], default: 'hecho' } }, required: ['id'] },
      run: async ({ id, status = 'hecho' }) => {
        need(id, 'el id');
        return { updated: true, task: await call('PATCH', `/tasks/${id}`, { st: status }) };
      },
    },
    {
      name: 'list_projects',
      title: 'Ver proyectos',
      description: 'List projects with their people and how many tasks are still open.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: async () => {
        const all: any[] = await call('GET', '/projects');
        return all.map((p) => ({
          id: p.id, title: p.title, status: p.status, desc: p.desc || undefined,
          people: p.people.map((x: any) => ({ id: x.cid, name: contactName(x.cid), role: x.role || undefined })),
          openTasks: p.tasks.filter((t: any) => t.st !== 'hecho').length,
        }));
      },
    },
    {
      name: 'add_project',
      title: 'Crear proyecto',
      description: 'Create a project, with the people involved. Use add_task afterwards for its to-dos.',
      inputSchema: {
        type: 'object',
        properties: {
          title: str('Project name.'),
          desc: str('One line on what it is.'),
          people: { type: 'array', items: { type: 'object', properties: { contactId: int('Contact id.'), role: str('Their role in the project.') }, required: ['contactId'] } },
        },
        required: ['title'],
      },
      run: async ({ title, desc, people = [] }) => {
        need(title?.trim?.(), 'el título');
        const p = await call('POST', '/projects', { title: title.trim(), desc: desc ?? '', people: people.map((x: any) => ({ cid: x.contactId, role: x.role ?? '' })) });
        return { created: true, project: { id: p.id, title: p.title, people: p.people } };
      },
    },
  ];
}

export const SERVER_INSTRUCTIONS = `Stölk is the user's personal CRM (people, notes, conversations, projects and tasks). It runs on the user's own computer and these tools read and write its local database.

When the user says "pásalo a Stölk", "guárdalo en Stölk" or similar:
1. Go through the conversation and pick out the people, what was talked about with each, and any to-dos or follow-ups.
2. For each person, call search_contacts first. Update the existing person with update_contact, or create one with add_contact.
3. Record what happened with log_interaction, and to-dos with add_task.
4. Finish with a short summary, in the user's language, of what you saved and where.

Only save what the user said or shared in this conversation. Never look people up on the web or elsewhere to fill in details. If something is ambiguous (which person, which date), ask before writing.`;

export const PROMPTS = [
  {
    name: 'pasar_a_stolk',
    title: 'Pasar a Stölk',
    description: 'Guarda en Stölk las personas, notas y tareas de esta conversación.',
    text:
      'Pasa a Stölk lo que hemos hablado en esta conversación: las personas que han salido (busca antes si ya existen), ' +
      'lo que se habló con cada una y las tareas o seguimientos pendientes. Al terminar, dime en una lista corta qué has guardado.',
  },
];
