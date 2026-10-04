// Secrets never enter the vault. A copy of the engine's src/secret-redact.ts
// (keep the code identical): the desktop masks the threads it saves and, as a
// backstop, the entity digests and mention snippets it shows. The engine's
// copy is what every vault write path runs text through (prompt capture, chat threads, entity digests and
// mentions, decision capture, linked notes, knowledge-source reads) and the
// one the scrub of an existing vault uses. Unlike privacy.redact (PII for
// egress: emails, phones), this keeps ordinary personal text and masks only
// credentials, each value as "[redacted]" so the sentence still reads.
//
// Deterministic and idempotent: masking masked text changes nothing, which
// keeps capture dedup keys stable.

export const MASK = "[redacted]";

// A labelled credential: "password: x", "Starter password = x", "PIN 1234",
// "api key: x". The label and separator stay; the value is masked.
const LABEL =
  "(?:(?:starter|temp(?:orary)?|initial|default|one[- ]time|wifi|wi-fi|admin|root|account|login|sign[- ]?in|app|master)\\s+)?" +
  "(?:password|passwd|pwd|passcode|passphrase|pass\\s*code|pin(?:\\s*code)?|api[ _-]?key|secret(?:[ _-]?key)?|client[ _-]?secret|access[ _-]?token|auth[ _-]?token|refresh[ _-]?token|token)";
// Separator: ":" / "=" / " is " / " - ", or plain whitespace (then the value
// must look like a secret, so "password reset" is left alone).
const LABELLED = new RegExp(
  `\\b(${LABEL})\\b(["']?(?:\\s*[:=]\\s*|\\s+(?:is|was)\\s*:?\\s+|\\s+-\\s+|\\s+))("[^"\\n]{1,200}"|'[^'\\n]{1,200}'|\`[^\`\\n]{1,200}\`|[^\\s"'\`]{1,200})`,
  "gi",
);

const TOKEN_RES: RegExp[] = [
  // PEM private keys, the whole block.
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,
  // Vendor tokens by prefix.
  /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|(?:pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprse]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[0-9A-Za-z_-]{16,}|xai-[0-9A-Za-z]{16,})/g,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g,
];
// "Bearer <token>": keep the word.
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{12,})/g;
// A long high-entropy run with upper, lower and digit (base64/url-safe keys),
// only next to a credential word: bare long ids (Drive files, sessions,
// videos) are everywhere in a vault and are not secrets.
const LONG_TOKEN = /(?<![A-Za-z0-9_+=-])[A-Za-z0-9_+=-]{32,}(?![A-Za-z0-9_+=-])/g;
const CRED_CONTEXT = /(key|token|secret|passw|pwd|auth|credential|bearer)[^\n]{0,40}$/i;
// A card number, Luhn valid, starting 2-6: grouped 4-4-4-4(-n) or Amex
// 4-6-5 anywhere; a bare 13-19 digit run only next to a card word.
const CARD = /(?<![\d.-])(?:[2-6]\d{3}([ -])\d{4}\1\d{4}\1\d{1,7}|3[47]\d{2}([ -])\d{6}\2\d{5}|[2-6]\d{12,18})(?![\d.-])/g;
const CARD_CONTEXT = /(card|visa|mastercard|amex|credit|debit|\bcc\b)[^\n]{0,30}$/i;

function entropy(s: string): number {
  const f = new Map<string, number>();
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of f.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// After a bare space ("password Hunter2!") a value must look generated:
// letters and digits, or digits only for a PIN. Plain words stay.
function looksSecret(v: string): boolean {
  if (/^\d{4,}$/.test(v)) return true;
  return v.length >= 6 && /\d/.test(v) && /[A-Za-z]/.test(v);
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Mask every credential in `text`. Returns the text and how many were masked. */
export function redactSecrets(text: string): { text: string; count: number; byRule: Record<string, number> } {
  const byRule: Record<string, number> = {};
  if (typeof text !== "string" || !text) return { text: text ?? "", count: 0, byRule };
  let n = 0;
  const hit = (rule: string) => { n++; byRule[rule] = (byRule[rule] ?? 0) + 1; };
  let out = text;
  TOKEN_RES.forEach((re, i) => { out = out.replace(re, () => (hit(["private-key", "vendor-token", "jwt"][i]), MASK)); });
  out = out.replace(BEARER, (_m, pre: string) => (hit("bearer"), `${pre}${MASK}`));
  out = out.replace(LABELLED, (m, label: string, sep: string, raw: string) => {
    const q = /^["'`]/.test(raw) ? raw[0] : "";
    const inner = q ? raw.slice(1, raw.endsWith(q) ? -1 : undefined) : raw;
    const value = inner.replace(/[.,;:!?)\]]+$/, "");
    const trail = inner.slice(value.length) + (q && raw.endsWith(q) && raw.length > 1 ? q : "");
    if (!value || value === MASK || value.startsWith("[redacted")) return m;
    const pinLabel = /\bpin\b/i.test(label);
    const loose = !/[:=]|\s-\s/.test(sep);
    // "PIN" wants digits; a loose separator wants a value that looks like one.
    if (pinLabel && !/^\d{4,8}$/.test(value)) return m;
    if (loose && !looksSecret(value)) return m;
    if (!loose && !pinLabel && value.length < 4) return m;
    hit("labelled");
    return `${label}${sep}${q}${MASK}${trail}`;
  });
  out = out.replace(LONG_TOKEN, (m, off: number, all: string) => {
    if (m.includes(MASK) || !CRED_CONTEXT.test(all.slice(Math.max(0, off - 60), off))) return m;
    if (!(/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m)) || entropy(m) < 4) return m;
    hit("long-token");
    return MASK;
  });
  out = out.replace(CARD, (m: string, ...rest: unknown[]) => {
    const off = rest[rest.length - 2] as number;
    const all = rest[rest.length - 1] as string;
    const d = m.replace(/[ -]/g, "");
    if (d.length < 13 || d.length > 19 || !luhn(d)) return m;
    if (d === m && !CARD_CONTEXT.test(all.slice(Math.max(0, off - 40), off))) return m;
    hit("card");
    return MASK;
  });
  return { text: out, count: n, byRule };
}

/** Just the masked text. */
export function maskSecrets(text: string): string {
  return redactSecrets(text).text;
}

/** Mask every string inside a JSON-shaped value (records, digests). */
export function maskDeep<T>(v: T): { value: T; count: number } {
  let count = 0;
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") {
      const r = redactSecrets(x);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) o[k] = walk(val);
      return o;
    }
    return x;
  };
  return { value: walk(v) as T, count };
}
