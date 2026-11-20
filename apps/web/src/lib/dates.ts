const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(d: Date, fmt = 'YYYY-MM-DD') {
  return fmt
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()));
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Fill {{date}}, {{date:FORMAT}}, {{time}}, {{title}}, {{yesterday}} and {{tomorrow}}. */
export function applyTemplate(template: string, title: string, now = new Date()) {
  return template
    .replace(/\{\{\s*date:([^}]+)\}\}/g, (_, f) => formatDate(now, f.trim()))
    .replace(/\{\{\s*date\s*\}\}/g, formatDate(now))
    .replace(/\{\{\s*time\s*\}\}/g, formatDate(now, 'HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/g, title)
    .replace(/\{\{\s*yesterday\s*\}\}/g, formatDate(addDays(now, -1)))
    .replace(/\{\{\s*tomorrow\s*\}\}/g, formatDate(addDays(now, 1)));
}

export function relativeTime(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
