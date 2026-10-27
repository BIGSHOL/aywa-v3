// TypeSafe key lookup for the decision adapter (server only).
// Default: process.env.TYPESAFE_API_KEY. Local dev may point
// OWNER_CONCEPT_TYPESAFE_KEY_FILE at a dotenv-style secret file; only the one
// TYPESAFE_API_KEY line is parsed in memory. The file is never sourced, other
// lines are never returned, and nothing here logs the value, a prefix or a length.
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const KEY_NAME = 'TYPESAFE_API_KEY';
const MAX_FILE_BYTES = 256 * 1024;

/** Value of exactly one `NAME=value` line, or null. Quotes and trailing comments are stripped. */
export function extractEnvValue(text, name = KEY_NAME) {
  if (typeof text !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) return null;
  let found = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match || match[1] !== name) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) value = value.slice(1, value.indexOf(quote, 1));
    else value = value.replace(/\s+#.*$/, '').trim();
    found = value; // dotenv semantics: the last assignment wins
  }
  return found && /^[\x21-\x7e]+$/.test(found) ? found : null;
}

/**
 * Returns { apiKey, source } where source is 'env' | 'file', or null when no key is configured.
 * The returned object must stay in memory; callers log only `source`.
 */
export async function loadTypesafeKey({ env = process.env, secretFile = env.OWNER_CONCEPT_TYPESAFE_KEY_FILE } = {}) {
  const direct = typeof env[KEY_NAME] === 'string' ? env[KEY_NAME].trim() : '';
  if (direct) return Object.freeze({ apiKey: direct, source: 'env' });
  if (!secretFile) return null;
  if (!isAbsolute(secretFile)) throw new Error('secret file path must be absolute');
  const text = await readFile(secretFile, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error('secret file is too large');
  const apiKey = extractEnvValue(text, KEY_NAME);
  return apiKey ? Object.freeze({ apiKey, source: 'file' }) : null;
}

/** Replaces any occurrence of the key in diagnostic text before it can reach a log or report. */
export function redactSecret(text, apiKey) {
  const value = String(text ?? '');
  return apiKey && apiKey.length >= 8 ? value.split(apiKey).join('[redacted]') : value;
}
