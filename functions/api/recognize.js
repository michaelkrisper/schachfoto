import { boardToPlacement, orientByPawns, parseRanks } from '../../public/js/position.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PROMPT = `Auf dem Foto ist ein Schachbrett (echtes Brett, Bildschirm oder Diagramm).
Bestimme die Stellung Feld für Feld.

Vorgehen:
1. Finde die vier Ecken des Bretts und lege gedanklich das 8x8-Raster darüber. Bei schräger Perspektive sind hintere Reihen gestaucht und hohe Figuren ragen ins Feld dahinter - ordne jede Figur dem Feld zu, auf dem ihr Fuß steht.
2. Bestimme die Ausrichtung: Sind Koordinaten (a-h, 1-8) am Rand zu sehen, nutze sie. Sonst: Weiß startet auf den Reihen 1 und 2, weiße Bauern ziehen Richtung Reihe 8. Stehen die weißen Figuren im Bild oben, wurde das Brett von Schwarz' Seite fotografiert - dann musst du die Stellung für die Ausgabe um 180° drehen. Das Eckfeld rechts vorne ist aus Sicht jedes Spielers hell.
3. Unterscheide Dame und König sowie Läufer und Bauer genau; bei Holzfiguren ist Weiß der helle Satz.

Gib die Stellung immer in Standardausrichtung zurück: ranks[0] ist die 8. Reihe (Schwarz' Grundreihe), ranks[7] die 1. Reihe, jeweils von a nach h.
Jede Reihe ist genau 8 Zeichen lang: K D T L S B wird als FEN-Buchstabe K Q R B N P geschrieben, Weiß groß, Schwarz klein, leeres Feld als Punkt.
Beispiel Grundstellung: ["rnbqkbnr","pppppppp","........","........","........","........","PPPPPPPP","RNBQKBNR"].

Ist kein Schachbrett erkennbar, setze board_found auf false.
Felder, bei denen du unsicher bist, listest du in uncertain (z.B. "e4").
note: ein kurzer deutscher Satz, falls etwas auffällt (z.B. Teile des Bretts verdeckt), sonst leer.`;

// Gemini's OpenAPI-style schema subset.
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    board_found: { type: 'BOOLEAN' },
    ranks: { type: 'ARRAY', items: { type: 'STRING' } },
    uncertain: { type: 'ARRAY', items: { type: 'STRING' } },
    note: { type: 'STRING' },
  },
  required: ['board_found', 'ranks', 'uncertain', 'note'],
  propertyOrdering: ['board_found', 'ranks', 'uncertain', 'note'],
};

// Free-tier models, tried in order. Each has its own quota, so when one is
// overloaded (503) or rate-limited (429) the next often still answers.
// Measured 2026-10-10 on two test boards: 3.6 Flash 12-15 s and correct;
// 3 Flash Preview 7-73 s and correct; 3.8 Flash ran >120 s into timeouts,
// so it is only the last resort. 3.5 Flash-Lite was fast but misread colours.
const MODELS = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.8-flash'];
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRY_NEXT = new Set([429, 500, 503, 524]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s)).then((d) => new Uint8Array(d))),
  );
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export async function onRequestPost({ request, env }) {
  if (env.ACCESS_CODE && !(await sameSecret(request.headers.get('x-access-code') ?? '', env.ACCESS_CODE))) {
    return json({ error: 'code' }, 401);
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: 'Bilderkennung ist auf dem Server noch nicht eingerichtet.' }, 503);
  }

  const { image, mediaType } = await request.json().catch(() => ({}));
  if (typeof image !== 'string' || !/^image\/(jpeg|png|webp)$/.test(mediaType ?? '')) {
    return json({ error: 'Kein Bild erhalten.' }, 400);
  }
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: 'Bild ist zu groß.' }, 413);

  const payload = JSON.stringify({
    contents: [
      { role: 'user', parts: [{ inlineData: { mimeType: mediaType, data: image } }, { text: PROMPT }] },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      thinkingConfig: { thinkingLevel: 'high' },
    },
  });
  let res;
  for (const model of MODELS) {
    res = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: payload,
    });
    if (!RETRY_NEXT.has(res.status)) break;
    console.error('gemini', model, res.status);
  }
  if (res.status === 429) {
    return json(
      { error: 'Gratis-Kontingent gerade aufgebraucht, bitte in einer Minute nochmal versuchen.' },
      429,
    );
  }
  if (res.status === 503) {
    return json({ error: 'Google ist gerade überlastet, bitte gleich nochmal versuchen.' }, 503);
  }
  if (!res.ok) {
    console.error('gemini', res.status, await res.text());
    return json({ error: `Erkennung fehlgeschlagen (${res.status}).` }, 502);
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') {
    console.error('gemini finish', candidate?.finishReason, data.promptFeedback);
    return json({ error: 'Erkennung abgebrochen, bitte nochmal versuchen.' }, 502);
  }
  const text = candidate.content.parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('');
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    return json({ error: 'Antwort der Erkennung war unlesbar.' }, 502);
  }
  if (!result.board_found) return json({ error: result.note || 'Kein Schachbrett erkannt.' }, 422);

  let placement;
  try {
    placement = boardToPlacement(orientByPawns(parseRanks(result.ranks)));
  } catch (err) {
    console.error('bad ranks', result.ranks, err.message);
    return json({ error: 'Erkannte Stellung war unvollständig, bitte nochmal fotografieren.' }, 502);
  }
  return json({
    placement,
    uncertain: result.uncertain.filter((s) => /^[a-h][1-8]$/.test(s)),
    note: result.note,
  });
}
