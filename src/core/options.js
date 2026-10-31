import fsp from 'node:fs/promises';
import path from 'node:path';

/** 浏览器/系统 locale → Minecraft 语言代码。 */
const LANG_RULES = [
  [/^zh[-_](tw|hk|mo)/i, 'zh_tw'],
  [/^zh/i, 'zh_cn'],
  [/^en[-_]gb/i, 'en_gb'],
  [/^en/i, 'en_us'],
  [/^ja/i, 'ja_jp'],
  [/^ko/i, 'ko_kr'],
  [/^fr/i, 'fr_fr'],
  [/^de/i, 'de_de'],
  [/^es[-_](mx|ar|us|cl|co)/i, 'es_mx'],
  [/^es/i, 'es_es'],
  [/^pt[-_]br/i, 'pt_br'],
  [/^pt/i, 'pt_pt'],
  [/^ru/i, 'ru_ru'],
  [/^it/i, 'it_it'],
  [/^pl/i, 'pl_pl'],
  [/^tr/i, 'tr_tr'],
  [/^uk/i, 'uk_ua'],
  [/^nl/i, 'nl_nl'],
  [/^sv/i, 'sv_se'],
  [/^cs/i, 'cs_cz'],
  [/^th/i, 'th_th'],
  [/^vi/i, 'vi_vn'],
  [/^id/i, 'id_id'],
];

export const LANGUAGES = [
  ['zh_cn', '简体中文'],
  ['zh_tw', '繁體中文'],
  ['en_us', 'English (US)'],
  ['en_gb', 'English (UK)'],
  ['ja_jp', '日本語'],
  ['ko_kr', '한국어'],
  ['fr_fr', 'Français'],
  ['de_de', 'Deutsch'],
  ['es_es', 'Español'],
  ['es_mx', 'Español (México)'],
  ['pt_br', 'Português (Brasil)'],
  ['ru_ru', 'Русский'],
  ['it_it', 'Italiano'],
  ['pl_pl', 'Polski'],
  ['tr_tr', 'Türkçe'],
  ['uk_ua', 'Українська'],
  ['nl_nl', 'Nederlands'],
  ['sv_se', 'Svenska'],
  ['cs_cz', 'Čeština'],
  ['th_th', 'ไทย'],
  ['vi_vn', 'Tiếng Việt'],
  ['id_id', 'Bahasa Indonesia'],
];

export function mcLang(locale) {
  const value = String(locale || '').trim();
  if (!value) return 'en_us';
  for (const [re, lang] of LANG_RULES) {
    if (re.test(value)) return lang;
  }
  return 'en_us';
}

export function parseOptions(text) {
  const lines = String(text || '').split(/\r?\n/);
  const map = new Map();
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
  }
  return { lines, map };
}

/** 在保留未知键和顺序的前提下合并 patch；值为 null/undefined 表示删除。 */
export function mergeOptions(text, patch) {
  const { lines, map } = parseOptions(text);
  const keys = new Set(Object.keys(patch || {}));
  const out = [];
  const written = new Set();

  for (const line of lines) {
    const i = line.indexOf(':');
    const key = i > 0 ? line.slice(0, i) : null;
    if (key && keys.has(key)) {
      if (!written.has(key)) {
        const value = patch[key];
        if (value !== null && value !== undefined) out.push(`${key}:${value}`);
        written.add(key);
      }
      continue;
    }
    if (line !== '' || out.length > 0) out.push(line);
  }
  for (const key of keys) {
    if (written.has(key)) continue;
    const value = patch[key];
    if (value !== null && value !== undefined) out.push(`${key}:${value}`);
  }
  // 去掉尾部空行
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

export async function readOptions(dir) {
  const file = path.join(dir, 'options.txt');
  try {
    const text = await fsp.readFile(file, 'utf8');
    return { text, options: Object.fromEntries(parseOptions(text).map) };
  } catch {
    return { text: '', options: {} };
  }
}

export async function updateOptions(dir, patch) {
  const { text } = await readOptions(dir);
  const next = mergeOptions(text, patch);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'options.txt'), next, 'utf8');
  return Object.fromEntries(parseOptions(next).map);
}

/** 首次启动时按系统语言写 lang；已有 lang 则尊重玩家选择。 */
export async function ensureLanguage(dir, locale) {
  const { text, options } = await readOptions(dir);
  if (options.lang) return { changed: false, lang: options.lang };
  const lang = mcLang(locale);
  await updateOptions(dir, { lang });
  return { changed: true, lang };
}
