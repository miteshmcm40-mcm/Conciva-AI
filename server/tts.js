import 'dotenv/config';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// =============================================================================
// TTS previews — Google Cloud Text-to-Speech.
//
// Live calls speak with Gemini Live voices (Fenrir, Aoede, Kore, …). Those are
// rendered by the dashboard.<reseller>/mcp side and have no standalone preview
// endpoint. For the ▶ preview MP3 we use Google Cloud TTS Neural2/Studio
// voices — same Google ecosystem, closest available timbre per Gemini voice.
//
// Auth: API key via GOOGLE_TTS_API_KEY (simplest setup — no service account
// JSON needed). Requires the "Cloud Text-to-Speech API" to be enabled on the
// linked Google Cloud project.
// =============================================================================

// Canonical Gemini-voice catalog the customer-facing picker shows. Each one
// maps to a Google Cloud TTS voice with the closest timbre.
//
// All map to en-US Neural2 / Studio voices when previewing English; for non-
// English previews we swap in a language-matched voice (see voiceForLang()).
export const TTS_VOICES = [
  'Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir',
  'Leda', 'Orus', 'Zephyr', 'Algieba', 'Sulafat',
];

// Gemini voice → Google Cloud TTS voice (en-US). Picks Neural2/Studio voices
// that approximate each Gemini voice's tone description.
const GEMINI_TO_GOOGLE_EN = {
  Kore:    'en-US-Neural2-F',   // calm, balanced (female)
  Puck:    'en-US-Neural2-D',   // bright, energetic (male)
  Charon:  'en-US-Neural2-J',   // informative, steady (male)
  Aoede:   'en-US-Neural2-H',   // warm, breathy (female)
  Fenrir:  'en-US-Neural2-A',   // excitable, young (male)
  Leda:    'en-US-Neural2-C',   // youthful, friendly (female)
  Orus:    'en-US-Neural2-I',   // firm, authoritative (male)
  Zephyr:  'en-US-Neural2-G',   // bright, lively (female)
  Algieba: 'en-US-Neural2-E',   // smooth, balanced (female)
  Sulafat: 'en-US-Studio-Q',    // refined, professional (male)
};

// Legacy compatibility — anywhere that still calls mapToPreviewVoice() gets
// a passthrough now (the live agent uses the same Gemini voice name, no
// translation needed). Kept as a stable export so language.js/syncAgent
// doesn't need a coordinated rename.
export function mapToPreviewVoice(voice) {
  if (TTS_VOICES.includes(voice)) return voice;
  return 'Leda';
}

const KEY = process.env.GOOGLE_TTS_API_KEY || '';
export const ttsConfigured = !!KEY;

const CACHE_DIR = path.join(process.cwd(), 'server', 'tts-cache');

const DEFAULT_EN = process.env.TTS_PREVIEW_TEXT
  || "Hi there! Thanks for calling. I'm your AI receptionist — how can I help you today?";

export const TTS_LANG_TEXTS = {
  'en-US': DEFAULT_EN,
  'en-US': "Hello! Thanks for calling. I'm your AI receptionist — how may I help you today?",
  'hi-IN': 'नमस्ते! कॉल करने के लिए धन्यवाद। मैं आपकी एआई रिसेप्शनिस्ट हूँ — आज मैं आपकी कैसे मदद कर सकती हूँ?',
  'bn-IN': 'নমস্কার! ফোন করার জন্য ধন্যবাদ। আমি আপনার এআই রিসেপশনিস্ট — আজ আপনাকে কীভাবে সাহায্য করতে পারি?',
  'te-IN': 'నమస్తే! కాల్ చేసినందుకు ధన్యవాదాలు. నేను మీ AI రిసెప్షనిస్ట్ — ఈ రోజు మీకు ఎలా సహాయపడగలను?',
  'mr-IN': 'नमस्कार! फोन केल्याबद्दल धन्यवाद. मी तुमची एआय रिसेप्शनिस्ट आहे — आज मी तुमची कशी मदत करू शकते?',
  'ta-IN': 'வணக்கம்! அழைத்ததற்கு நன்றி. நான் உங்கள் AI வரவேற்பாளர் — இன்று உங்களுக்கு எப்படி உதவ முடியும்?',
  'ur-IN': 'السلام علیکم! کال کرنے کا شکریہ۔ میں آپ کی اے آئی ریسیپشنسٹ ہوں — آج میں آپ کی کیسے مدد کر سکتی ہوں؟',
  'gu-IN': 'નમસ્તે! કૉલ કરવા બદલ આભાર. હું તમારી AI રિસેપ્શનિસ્ટ છું — આજે હું તમારી કેવી રીતે મદદ કરી શકું?',
  'kn-IN': 'ನಮಸ್ಕಾರ! ಕರೆ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. ನಾನು ನಿಮ್ಮ AI ರಿಸೆಪ್ಷನಿಸ್ಟ್ — ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ?',
  'ml-IN': 'നമസ്കാരം! വിളിച്ചതിന് നന്ദി. ഞാൻ നിങ്ങളുടെ AI റിസെപ്ഷനിസ്റ്റാണ് — ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?',
  'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਕਾਲ ਕਰਨ ਲਈ ਧੰਨਵਾਦ। ਮੈਂ ਤੁਹਾਡੀ AI ਰਿਸੈਪਸ਼ਨਿਸਟ ਹਾਂ — ਅੱਜ ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?',
  'or-IN': 'ନମସ୍କାର! କଲ୍ କରିଥିବାରୁ ଧନ୍ୟବାଦ। ମୁଁ ଆପଣଙ୍କ AI ରିସେପ୍ସନିଷ୍ଟ — ଆଜି ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?',
  'as-IN': 'নমস্কাৰ! ফোন কৰাৰ বাবে ধন্যবাদ। মই আপোনাৰ AI ৰিচেপশ্যনিষ্ট — আজি মই আপোনাক কেনেকৈ সহায় কৰিব পাৰোঁ?',
};

export const SUPPORTED_LANGS = Object.keys(TTS_LANG_TEXTS);

const normalizeLang = (raw) => {
  const v = String(raw || 'en-US');
  return TTS_LANG_TEXTS[v] ? v : 'en-US';
};

// Pick a Google TTS voice for the requested (gemini-voice, language) pair.
//
// For each non-English language we list ALL available Google voices on that
// locale and pick by Gemini voice's index in TTS_VOICES — so different
// Gemini voices always get different Google voices within a language
// (modulo the number of voices Google actually ships for that locale).
// Without this, every Gemini voice in Hindi was rendering as the same
// hi-IN-Neural2-A and the previews all sounded identical.
//
// For locales where Google ships fewer than 10 voices the cycle naturally
// wraps — e.g. ur-IN only has 4 distinct voices so previews 0/4/8 share a
// voice, 1/5/9 share a voice, etc. (best Google offers).
const LANG_VOICES = {
  'en-US': ['en-US-Neural2-A', 'en-US-Neural2-B', 'en-US-Neural2-C', 'en-US-Neural2-D', 'en-US-Wavenet-A', 'en-US-Wavenet-B', 'en-US-Wavenet-C', 'en-US-Wavenet-D', 'en-US-Wavenet-E', 'en-US-Wavenet-F'],
  'hi-IN': ['hi-IN-Neural2-A', 'hi-IN-Neural2-B', 'hi-IN-Neural2-C', 'hi-IN-Neural2-D', 'hi-IN-Wavenet-A', 'hi-IN-Wavenet-B', 'hi-IN-Wavenet-C', 'hi-IN-Wavenet-D', 'hi-IN-Wavenet-E', 'hi-IN-Wavenet-F'],
  'bn-IN': ['bn-IN-Standard-A', 'bn-IN-Standard-B', 'bn-IN-Standard-C', 'bn-IN-Standard-D', 'bn-IN-Wavenet-A', 'bn-IN-Wavenet-B', 'bn-IN-Wavenet-C', 'bn-IN-Wavenet-D'],
  'te-IN': ['te-IN-Standard-A', 'te-IN-Standard-B', 'te-IN-Standard-C', 'te-IN-Standard-D'],
  'mr-IN': ['mr-IN-Standard-A', 'mr-IN-Standard-B', 'mr-IN-Standard-C', 'mr-IN-Wavenet-A', 'mr-IN-Wavenet-B', 'mr-IN-Wavenet-C'],
  'ta-IN': ['ta-IN-Standard-A', 'ta-IN-Standard-B', 'ta-IN-Standard-C', 'ta-IN-Standard-D', 'ta-IN-Wavenet-A', 'ta-IN-Wavenet-B', 'ta-IN-Wavenet-C', 'ta-IN-Wavenet-D'],
  'ur-IN': ['ur-IN-Standard-A', 'ur-IN-Standard-B', 'ur-IN-Wavenet-A', 'ur-IN-Wavenet-B'],
  'gu-IN': ['gu-IN-Standard-A', 'gu-IN-Standard-B', 'gu-IN-Standard-C', 'gu-IN-Standard-D', 'gu-IN-Wavenet-A', 'gu-IN-Wavenet-B', 'gu-IN-Wavenet-C', 'gu-IN-Wavenet-D'],
  'kn-IN': ['kn-IN-Standard-A', 'kn-IN-Standard-B', 'kn-IN-Standard-C', 'kn-IN-Standard-D', 'kn-IN-Wavenet-A', 'kn-IN-Wavenet-B', 'kn-IN-Wavenet-C', 'kn-IN-Wavenet-D'],
  'ml-IN': ['ml-IN-Standard-A', 'ml-IN-Standard-B', 'ml-IN-Standard-C', 'ml-IN-Standard-D', 'ml-IN-Wavenet-A', 'ml-IN-Wavenet-B', 'ml-IN-Wavenet-C', 'ml-IN-Wavenet-D'],
  'pa-IN': ['pa-IN-Standard-A', 'pa-IN-Standard-B', 'pa-IN-Standard-C', 'pa-IN-Standard-D', 'pa-IN-Wavenet-A', 'pa-IN-Wavenet-B', 'pa-IN-Wavenet-C', 'pa-IN-Wavenet-D'],
};

const voiceForLang = (geminiVoice, lang) => {
  if (lang === 'en-US') return GEMINI_TO_GOOGLE_EN[geminiVoice] || GEMINI_TO_GOOGLE_EN.Leda;
  const pool = LANG_VOICES[lang];
  if (!pool || !pool.length) return GEMINI_TO_GOOGLE_EN[geminiVoice] || GEMINI_TO_GOOGLE_EN.Leda;
  const idx = TTS_VOICES.indexOf(geminiVoice);
  return pool[(idx < 0 ? 0 : idx) % pool.length];
};

await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});

const filenameFor = (voice, lang) => {
  const l = normalizeLang(lang);
  return l === 'en-US'
    ? path.join(CACHE_DIR, `${voice}.mp3`)
    : path.join(CACHE_DIR, `${voice}_${l}.mp3`);
};

export async function generateSample(voice, lang = 'en-US') {
  if (!ttsConfigured) throw new Error('Google Cloud TTS not configured — set GOOGLE_TTS_API_KEY in .env');
  if (!TTS_VOICES.includes(voice)) throw new Error(`Unknown voice "${voice}"`);
  const useLang = normalizeLang(lang);
  const out = filenameFor(voice, useLang);
  if (existsSync(out)) return out;
  const text = TTS_LANG_TEXTS[useLang];
  const googleVoice = voiceForLang(voice, useLang);
  // Locale code is the prefix before the second hyphen — e.g. en-US-Neural2-F → en-US.
  const languageCode = googleVoice.split('-').slice(0, 2).join('-');

  try {
    const resp = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode, name: googleVoice },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      // Decode the structured Google error so the UI surfaces the real cause
      // (API not enabled vs invalid key vs billing-disabled) rather than a raw
      // status code. The "API_KEY_SERVICE_BLOCKED" reason is the most common
      // first-time setup failure — TTS not enabled on the project.
      let reason = '';
      let projectNumber = '';
      try {
        const j = JSON.parse(body);
        reason = j?.error?.details?.find((d) => d?.reason)?.reason || '';
        projectNumber = j?.error?.details?.find((d) => d?.metadata?.consumer)?.metadata?.consumer?.replace(/^projects\//, '') || '';
      } catch {}
      const err = new Error(`Google TTS ${resp.status}: ${body.slice(0, 300)}`);
      err.status = resp.status;
      err.reason = reason;
      err.projectNumber = projectNumber;
      throw err;
    }
    const { audioContent } = await resp.json();
    if (!audioContent) throw new Error('Google TTS returned no audioContent');
    await fs.writeFile(out, Buffer.from(audioContent, 'base64'));
    return out;
  } catch (e) {
    // Fall back to the cached en-US sample if available so the UI plays
    // *something* even when the requested locale fails.
    const fallback = filenameFor(voice, 'en-US');
    if (existsSync(fallback) && useLang !== 'en-US') {
      console.warn(`[tts] generation failed for ${voice}/${useLang}, falling back to en-US cache:`, e.message);
      return fallback;
    }
    // Promote 401/403 to a clearer message — most common failure mode is the
    // Cloud Text-to-Speech API not being enabled on the GCP project the API
    // key belongs to (Google returns reason = API_KEY_SERVICE_BLOCKED).
    if (e?.status === 401 || e?.status === 403) {
      const proj = e?.projectNumber || '<your-project>';
      const enableUrl = `https://console.cloud.google.com/apis/library/texttospeech.googleapis.com?project=${proj}`;
      const msg = e?.reason === 'API_KEY_SERVICE_BLOCKED'
        ? `Cloud Text-to-Speech API is not enabled on Google Cloud project ${proj}. Enable it at ${enableUrl} then retry.`
        : `Google Cloud TTS rejected the key (${e.reason || e.status}). Check GOOGLE_TTS_API_KEY in .env and enable Cloud Text-to-Speech at ${enableUrl}.`;
      const err = new Error(msg);
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// Read a cached (voice, language) sample without regenerating; null if missing.
export function cachedSamplePath(voice, lang = 'en-US') {
  if (!TTS_VOICES.includes(voice)) return null;
  const out = filenameFor(voice, lang);
  return existsSync(out) ? out : null;
}
