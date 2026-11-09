export function maskPhoneNumber(text) {
  if (!text) return text;
  return text.replace(/\d{10,}/g, '••••••••••');
}
