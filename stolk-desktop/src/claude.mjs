// Claude call owned by the desktop shell: read a screenshot Ivan took on purpose into a contact card.
// Questions (Preguntar) go through the local server's /preguntar route, not through here.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const MODEL = 'claude-opus-5-5';

export const ContactCard = z.object({
  found: z.boolean().describe('false if the image shows no identifiable person'),
  name: z.string(),
  role: z.string(),
  company: z.string(),
  email: z.string(),
  phone: z.string(),
  linkedin: z.string().describe('profile URL without https://, only if visible'),
  website: z.string(),
  notes: z.string().describe('one short sentence in Spanish with context visible in the image, e.g. what the post or chat is about'),
});

const CARD_PROMPT = `Esta es una captura de pantalla que Ivan ha hecho a propósito para guardar a una persona en su agenda.
Extrae solo lo que se ve en la imagen. No inventes ni completes nada que no aparezca: deja el campo vacío ("").
Si hay varias personas, quédate con la que ocupa el centro o el perfil principal.
No incluyas datos sensibles (salud, religión, política, orientación) aunque aparezcan.`;

export async function parseContact(client, pngBase64) {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low', format: zodOutputFormat(ContactCard) },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
      { type: 'text', text: CARD_PROMPT },
    ] }],
  });
  if (!res.parsed_output) throw new Error('Claude no devolvió una ficha válida');
  return res.parsed_output;
}

export function makeClient(apiKey) {
  if (!apiKey) throw new Error('Falta la clave de Claude. Ponla en Ajustes.');
  return new Anthropic({ apiKey });
}
