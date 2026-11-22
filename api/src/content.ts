/**
 * Wording that makes a notification look like spam or a scam. Chrome on Android runs an on-device model over each
 * notification's title, body and button labels and can hide it behind "possible spam"; Google does not publish what it
 * looks for, so this flags the patterns scam notifications are known for. Warnings, not a block: an editor decides.
 */
const RULES: { id: string; re: RegExp; why: string }[] = [
  { id: 'urgency', re: /\b(urgent|immediately|act now|right now|hurry|last chance|expires? (today|soon)|final (notice|warning)|within 24 hours)\b/i, why: 'Urgency is a classic scam signal.' },
  { id: 'money', re: /(₹|\$|€|£)\s?\d|\b(rs\.?|inr|usd)\s?\d|\b(cash|prize|lottery|jackpot|reward|refund|payment (due|failed)|bank|loan|credit|bitcoin|crypto|investment)\b/i, why: 'Money, prizes or banking words look like fraud.' },
  { id: 'winning', re: /\b(you('ve| have)? (won|been selected)|winner|congratulations|free gift|claim (your|now))\b/i, why: '"You have won" and "claim" phrasing is typical of scams.' },
  { id: 'clickbait', re: /\b(click|tap) (here|now|this|the link)\b|\bopen (now|immediately)\b/i, why: 'Telling people to click or tap reads as clickbait.' },
  { id: 'security', re: /\b(virus|infected|hacked|security alert|account (locked|suspended|blocked)|verify your (account|identity)|password|otp|kyc)\b/i, why: 'Fake security alerts are the most common notification scam.' },
  { id: 'link', re: /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|in|net|org|xyz|top|link)\b/i, why: 'Links in the text look like phishing; the notification already opens the app.' },
  { id: 'shouting', re: /\b[A-Z]{5,}\b.*\b[A-Z]{5,}\b|!!+/, why: 'Shouting (capitals, several exclamation marks) looks like spam.' },
  { id: 'phone', re: /(\+?\d[\d\s-]{9,}\d)/, why: 'Phone numbers in a notification look like a support scam.' },
];

export interface ContentWarning { id: string; why: string; match: string }
export function checkText(text: string): ContentWarning[] {
  const out: ContentWarning[] = [];
  for (const r of RULES) { const m = r.re.exec(text); if (m) out.push({ id: r.id, why: r.why, match: m[0] }); }
  if (text.trim().length > 0 && text.trim().length < 12) out.push({ id: 'too_short', why: 'Very short notes give the reader (and the spam check) little to go on.', match: text.trim() });
  return out;
}
