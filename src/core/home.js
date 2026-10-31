const MAX_ITEMS = 12;
const MAX_TITLE = 120;
const MAX_BODY = 800;
const MAX_DATE = 40;

function clamp(value, max) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 只接受 http(s) 地址，其它一律当没配置。 */
export function normalizeHomeUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * 纯函数：把「联网主页」返回的 JSON 规整成界面能直接渲染的结构。
 * 期望格式：{ "title": "...", "items": [{ "title": "...", "body": "...", "date": "...", "url": "..." }] }
 * 只保留文字与链接，不允许 HTML。
 */
export function parseHomeFeed(data) {
  if (!data || typeof data !== 'object') return { title: '', items: [] };
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    title: clamp(data.title, MAX_TITLE),
    items: items
      .slice(0, MAX_ITEMS)
      .map((item) => ({
        title: clamp(item?.title, MAX_TITLE),
        body: clamp(item?.body, MAX_BODY),
        date: clamp(item?.date, MAX_DATE),
        url: normalizeHomeUrl(item?.url),
      }))
      .filter((item) => item.title || item.body),
  };
}
