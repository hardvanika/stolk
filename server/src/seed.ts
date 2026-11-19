import { tx, type DB } from './db.js';
import { normEmail, normPhone } from './util.js';

/**
 * The prototype's example data, so the desktop UI has something to show in development.
 * Nothing here is real. Only runs on an empty database.
 */
export function seedDemo(db: DB) {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM contacts').get() as any).n;
  if (n) throw new Error('The database already has contacts; the demo seed only runs on an empty one.');

  const contacts = [
    [1, 'Lucía Romero', 'CEO', 'Voltia', 'lucia@voltia.example', '+34 600 112 201', 'linkedin.com/in/luciaromero', ['startup', 'energía'], 'Baterías domésticas. Busca ronda seed en primavera.'],
    [2, 'Jorge Sanz', 'Partner', 'Ribera Ventures', 'jorge@ribera.example', '+34 600 112 202', 'linkedin.com/in/jorgesanz', ['inversor'], 'Invierte en pre-seed deeptech. Prefiere intros por email.'],
    [3, 'Marta Ruiz', 'Investigadora', 'UC3M', 'mruiz@uc3m.example', '+34 600 112 203', '', ['universidad', 'IA'], 'Grafos de conocimiento y NLP. Puede dar una charla.'],
    [4, 'Pablo Ortega', 'CTO', 'Tiqueo', 'pablo@tiqueo.example', '+34 600 112 204', '', ['startup'], 'Ticketing para eventos. Posible patrocinio de Tech & Tapas.'],
    [5, 'Ana Belén Cruz', 'Community lead', 'Impact Lab', 'ana@impactlab.example', '+34 600 112 205', '', ['comunidad', 'espacios'], 'Nos puede ceder sala para 60 personas.'],
    [6, 'David Lin', 'ML Engineer', 'Freelance', 'david@lin.example', '+34 600 112 206', '', ['IA'], 'LLMs en local. Interesado en hablar en el demo day.'],
    [7, 'Sofía Herrera', 'Periodista', 'Diario Tech', 'sofia@diariotech.example', '+34 600 112 207', 'linkedin.com/in/sofiaherrera', ['prensa'], 'Cubre ecosistema startup en Madrid.'],
    [8, 'Tomás Vidal', 'Fundador', 'Grano', 'tomas@grano.example', '+34 600 112 208', '', ['startup', 'agro'], 'Agtech. Le presenté a Jorge en septiembre.'],
    [9, 'Elena Prieto', 'Head of Talent', 'Nubia', 'elena@nubia.example', '+34 600 112 209', 'linkedin.com/in/elenaprieto', ['empleo'], 'Contrata perfiles junior de IA.'],
  ] as const;

  const events = [
    [101, 'Tech & Tapas #4', '2026-12-03', '19:00', '22:00', 'Impact Lab, Madrid', 'https://lu.ma/tech-tapas-4', 'planeado', 'Cuarta edición. 60 plazas. Busco patrocinio de bebidas.',
      [[5, 'confirmado'], [4, 'confirmado'], [6, 'invitado'], [1, 'invitado'], [7, 'invitado']]],
    [102, 'Demo day IA UC3M', '2026-11-27', '17:00', '20:00', 'Campus Leganés, aula 1.0.4', '', 'planeado', '6 proyectos de estudiantes, jurado de 3.',
      [[3, 'confirmado'], [6, 'confirmado'], [9, 'invitado'], [2, 'invitado']]],
    [103, 'Tech & Tapas #3', '2026-10-08', '19:00', '22:00', 'Impact Lab, Madrid', '', 'hecho', '48 asistentes.',
      [[1, 'asistió'], [2, 'asistió'], [8, 'asistió'], [5, 'asistió']]],
  ] as const;

  const interactions: [number, string, string, string, string | null, number | null, string | null][] = [
    [1, '2026-10-08', 'evento', 'Nos conocimos en Tech & Tapas #3. Hablamos de baterías y de su ronda seed.', null, 103, null],
    [1, '2026-10-21', 'email', 'Le pasé el contacto de Jorge (Ribera Ventures) para la ronda.', '2026-11-21', null, null],
    [2, '2026-10-08', 'evento', 'Charla sobre financiación pre-seed en deeptech.', null, 103, null],
    [2, '2026-11-12', 'cal', 'Café 30 min (Cal.com). Le interesa Voltia; pide deck.', null, null, 'Café'],
    [3, '2026-09-20', 'reunion', 'Reunión en el campus sobre el demo day. Acepta ser jurado.', null, null, null],
    [3, '2026-11-16', 'mensaje', 'Confirmó aula y proyector para el 27.', null, null, null],
    [4, '2026-11-05', 'llamada', 'Patrocinio de Tech & Tapas #4: ofrece entradas y 300 € de bebidas.', '2026-11-24', null, null],
    [5, '2026-10-08', 'evento', 'Anfitriona de Tech & Tapas #3.', null, 103, null],
    [5, '2026-11-10', 'email', 'Reservada la sala para el 3 de diciembre.', null, null, null],
    [6, '2026-11-18', 'cal', 'Llamada 15 min (Cal.com). Hará demo de LLM local en el demo day.', null, null, 'Llamada'],
    [7, '2026-06-11', 'reunion', 'Entrevista sobre la comunidad. Quiere cubrir la próxima edición.', null, null, null],
    [8, '2026-10-08', 'evento', 'Agtech, buscando inversores.', null, 103, null],
    [8, '2026-09-02', 'email', 'Intro a Jorge Sanz.', null, null, null],
    [9, '2026-07-30', 'llamada', 'Busca 2 perfiles junior de IA para enero.', null, null, null],
  ];

  const relations = [
    [8, 2, 'Le presentaste', '2026-09-02'],
    [1, 2, 'Le presentaste', '2026-10-21'],
    [4, 5, 'Trabajan juntos en Tech & Tapas', null],
    [3, 6, 'Colaboran en el demo day', null],
  ] as const;

  const projects = [
    [301, 'Tech & Tapas #4', 'Cuarta edición en Impact Lab. Cerrar patrocinio y ponentes antes del 26 nov.', 101,
      [[4, 'Patrocinador'], [5, 'Sala'], [7, 'Prensa'], [1, 'Ponente']],
      [[4, 'Enviar logo y medidas del photocall', 'pendiente', '2026-11-21'], [5, 'Confirmar aforo y horario de montaje', 'enviado', '2026-11-20'],
       [7, 'Nota de prensa con la agenda', 'pendiente', '2026-11-26'], [1, 'Plantilla de slides para la charla', 'hecho', '2026-11-15']]],
    [302, 'Ronda de Voltia', 'Ayudar a Lucía a llegar a 3 fondos pre-seed.', null,
      [[1, 'Fundadora'], [2, 'Inversor']],
      [[2, 'Reenviar el deck actualizado de Voltia', 'pendiente', '2026-11-20'], [1, 'Lista de 5 fondos más con contacto', 'pendiente', '2026-11-27']]],
    [303, 'Demo day IA UC3M', '6 proyectos de estudiantes, jurado de 3, demo de LLM local.', 102,
      [[3, 'Jurado'], [6, 'Demo'], [9, 'Empleo']],
      [[3, 'Rúbrica de evaluación para el jurado', 'enviado', '2026-11-18'], [9, 'Lista de proyectos con perfiles junior', 'pendiente', '2026-11-25'],
       [6, 'Requisitos técnicos de la demo (proyector, red)', 'hecho', '2026-11-17']]],
  ] as const;

  const bookings = [
    [1, '2026-11-24', '10:00', '10:30', 'Café'], [7, '2026-11-25', '12:00', '12:45', 'Reunión'],
    [2, '2026-12-01', '09:30', '09:45', 'Llamada'], [9, '2026-11-19', '18:45', '19:00', 'Llamada'],
    [8, '2026-11-19', '20:00', '20:30', 'Café'],
  ] as const;

  const gcal = [
    ['g1', '2026-11-19', '16:00', '17:00', 'Tutoría TFG', 'UC3M, despacho 2.1.10'],
    ['g2', '2026-11-23', '10:00', '12:00', 'Clase de Sistemas Distribuidos', 'UC3M'],
    ['g3', '2026-11-26', '13:00', '13:30', 'Dentista', ''],
    ['g4', '2026-12-02', '09:00', '10:00', 'Reunión de la vocalía', 'Online'],
  ] as const;

  tx(db, () => {
    const c = db.prepare(`INSERT INTO contacts (id, name, role, company, email, email_norm, phone, phone_norm, linkedin, tags, notes)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [id, name, role, company, email, phone, li, tags, notes] of contacts) {
      c.run(id, name, role, company, email, normEmail(email), phone, normPhone(phone), li, JSON.stringify(tags), notes);
    }
    const e = db.prepare('INSERT INTO events (id, title, date, start, end, place, url, status, desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const g = db.prepare('INSERT INTO event_guests (event_id, cid, st) VALUES (?, ?, ?)');
    for (const [id, title, date, start, end, place, url, status, desc, guests] of events) {
      e.run(id, title, date, start, end, place, url, status, desc);
      for (const [cid, st] of guests) g.run(id, cid, st);
    }
    const i = db.prepare('INSERT INTO interactions (cid, date, ch, text, follow, event_id, cal_type) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const row of interactions) i.run(...row);
    const r = db.prepare('INSERT INTO relations (a, b, kind, date) VALUES (?, ?, ?, ?)');
    for (const row of relations) r.run(...row);
    const p = db.prepare('INSERT INTO projects (id, title, desc, status, event_id) VALUES (?, ?, ?, ?, ?)');
    const pp = db.prepare('INSERT INTO project_people (project_id, cid, role) VALUES (?, ?, ?)');
    const t = db.prepare('INSERT INTO tasks (project_id, cid, text, st, due) VALUES (?, ?, ?, ?, ?)');
    for (const [id, title, desc, eventId, people, tasks] of projects) {
      p.run(id, title, desc, 'En marcha', eventId);
      for (const [cid, role] of people) pp.run(id, cid, role);
      for (const [cid, text, st, due] of tasks) t.run(id, cid, text, st, due);
    }
    const b = db.prepare(`INSERT INTO bookings (cal_uid, cid, date, start, end, type, attendee_name, attendee_email)
                          SELECT ?, id, ?, ?, ?, ?, name, email FROM contacts WHERE id = ?`);
    bookings.forEach(([cid, date, start, end, type], k) => b.run(`demo-${k + 1}`, date, start, end, type, cid));
    const gc = db.prepare('INSERT INTO gcal (id, date, start, end, title, place) VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of gcal) gc.run(...row);
  });
}
