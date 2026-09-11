#!/usr/bin/env node
/* ============================================================
   debug-sincronia.js — prueba Whisper (Groq) suelto, sin pasar por
   la app ni por el Worker desplegado. Para afinar la sincronía de
   la letra mirando datos reales.

   Uso:
     $env:GROQ_API_KEY="gsk_..."        (PowerShell)
     node scripts/debug-sincronia.js "C:\ruta\audio.mp3" letra.txt [idioma]

   `letra.txt` = la letra, una línea por verso (líneas vacías se
   ignoran). `idioma` opcional: es/eu/la/de/en/fr/it/pt/ca (código
   ISO-639-1; se lo pasamos a Whisper como pista de idioma).

   No manda nada al Worker ni a Cloudflare: solo llama a Groq
   directamente, igual que hace `sincroniaWhisper` en
   worker/src/index.js, y vuelca:
     - el JSON crudo de Groq en debug-sincronia.json
     - un resumen por pantalla: nº de palabras, primeras/últimas,
       huecos > 3s entre palabras (posibles tramos sin cantar).
   ============================================================ */

const fs = require('fs');
const path = require('path');

async function main() {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.error('Falta GROQ_API_KEY en el entorno. En PowerShell:\n  $env:GROQ_API_KEY="gsk_..."');
    process.exit(1);
  }
  const audioPath = process.argv[2];
  const letraPath = process.argv[3];
  const idioma = process.argv[4] || '';
  if (!audioPath || !letraPath) {
    console.error('Uso: node scripts/debug-sincronia.js <audio.mp3> <letra.txt> [idioma]');
    process.exit(1);
  }
  if (!fs.existsSync(audioPath)) { console.error('No existe el audio:', audioPath); process.exit(1); }
  if (!fs.existsSync(letraPath)) { console.error('No existe la letra:', letraPath); process.exit(1); }

  const lineas = fs.readFileSync(letraPath, 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  console.log('Versos:', lineas.length);

  const bytes = fs.readFileSync(audioPath);
  const fd = new FormData();
  fd.append('file', new Blob([bytes]), path.basename(audioPath));
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  fd.append('temperature', '0');
  if (idioma) fd.append('language', idioma);
  // Sin `prompt` a propósito: le hace alucinar la letra al principio del
  // audio (ver worker/src/index.js). Si quieres probarlo de todas formas,
  // descomenta la línea de abajo.
  // fd.append('prompt', lineas.join(' ').slice(0, 850));

  console.log('Mandando a Groq (whisper-large-v3-turbo)...');
  const t0 = Date.now();
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key },
    body: fd,
  });
  console.log('HTTP', r.status, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  const data = await r.json();
  fs.writeFileSync('debug-sincronia.json', JSON.stringify(data, null, 2));
  console.log('Guardado el JSON crudo en debug-sincronia.json');

  if (!r.ok) { console.error('Error de Groq:', JSON.stringify(data)); process.exit(1); }

  const words = Array.isArray(data.words) ? data.words : [];
  console.log('\nPalabras transcritas:', words.length);
  if (words.length) {
    console.log('Primera palabra en:', words[0].start.toFixed(1) + 's ->', words[0].word);
    console.log('Última palabra en: ', words[words.length - 1].start.toFixed(1) + 's ->', words[words.length - 1].word);
    console.log('\nTranscripción (primeras 40 palabras):');
    console.log(words.slice(0, 40).map((w) => w.word).join(' '));

    console.log('\nHuecos > 3s entre palabras (posible silencio / instrumental / melisma):');
    for (let i = 1; i < words.length; i++) {
      const hueco = words[i].start - (words[i - 1].end != null ? words[i - 1].end : words[i - 1].start);
      if (hueco > 3) {
        console.log(
          '  ' + words[i - 1].start.toFixed(1) + 's-' + (words[i - 1].end || words[i - 1].start).toFixed(1) +
          's "' + words[i - 1].word + '"  ...(' + hueco.toFixed(1) + 's)...  ' +
          words[i].start.toFixed(1) + 's "' + words[i].word + '"'
        );
      }
    }
  } else if (Array.isArray(data.segments)) {
    console.log('(Sin marcas por palabra; segmentos:', data.segments.length + ')');
    data.segments.slice(0, 10).forEach((s) => {
      console.log('  ' + s.start.toFixed(1) + 's-' + s.end.toFixed(1) + 's: ' + s.text);
    });
  }

  console.log('\nDuración del audio (según el último segmento):',
    data.segments && data.segments.length ? data.segments[data.segments.length - 1].end.toFixed(1) + 's' : '?');
}

main().catch((e) => { console.error(e); process.exit(1); });
