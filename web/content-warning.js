export function normalizeContentWarning(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function contentWarningLabel(value) {
  const warning = normalizeContentWarning(value);
  return warning ? `内容预警 · ${warning}` : "";
}
