// Shared enum labels and helpers for the two status fields.
// The values here must match the server's allow-lists in functions/api/[[path]].js.

export const DATE_STATUS_OPTIONS = [
  ["none", "Not set"],
  ["rough", "Vague"],
  ["pencilled", "Pencilled in"],
  ["confirmed", "Confirmed"],
];

export const STATUS_OPTIONS = [
  ["idea", "Idea"],
  ["firming_up", "Firming up"],
  ["well_formed", "Well formed"],
  ["ready", "Ready"],
  ["archived", "Archived"],
];

export const SESSION_TYPE_OPTIONS = [
  ["tbc", "To be confirmed"],
  ["listening", "Listening session"],
  ["learning", "Learning session"],
];

const DATE_STATUS_MAP = new Map(DATE_STATUS_OPTIONS);
const STATUS_MAP = new Map(STATUS_OPTIONS);
const SESSION_TYPE_MAP = new Map(SESSION_TYPE_OPTIONS);

export function dateStatusLabel(value) {
  return DATE_STATUS_MAP.get(value) || value || "Not set";
}

export function statusLabel(value) {
  return STATUS_MAP.get(value) || value || "Idea";
}

export function sessionTypeLabel(value) {
  return SESSION_TYPE_MAP.get(value) || value || "To be confirmed";
}

// Best-effort sort key for the free-text date field.
// Blank and unparseable dates sort last (see the plan §2).
export function dateSortKey(text) {
  if (!text || !text.trim()) return Number.POSITIVE_INFINITY;
  const trimmed = text.trim();

  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) return direct;

  const monthYear = trimmed.match(/([A-Za-z]{3,})\s+(\d{4})/);
  if (monthYear) {
    const parsed = Date.parse(`1 ${monthYear[1]} ${monthYear[2]}`);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const yearOnly = trimmed.match(/\b(\d{4})\b/);
  if (yearOnly) {
    const parsed = Date.parse(`1 Jan ${yearOnly[1]}`);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return Number.POSITIVE_INFINITY;
}

// "2 Sep 2026, 14:32" in the viewer's locale.
export function formatEdited(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}
