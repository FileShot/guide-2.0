/**
 * R29: Centralized regex helpers for matching filePath and content fields
 * in model-generated JSON.
 *
 * Models (especially smaller ones like Qwen3.5-2B) frequently output tool
 * call JSON with escaped quotes in keys:
 *   \"filePath\":\"file.html\"  instead of  "filePath":"file.html"
 *
 * Before R29, only 1 of 38 regex locations handled escaped quotes. This
 * caused cascading failures: context shift retained 20 chars instead of
 * 8000+, content streaming used wrong language label, file extraction failed.
 *
 * These helpers try the standard pattern first, then the escaped-quote
 * variant, so every call site handles both formats.
 */
'use strict';

// ── Standard patterns (unescaped quotes) ─────────────────────────────────
const FP_STANDARD = /"(?:filePath|file_path|path|filename|file_name|file)"\s*:\s*"([^"]+)"/;
const CONTENT_START_STANDARD = /"content"\s*:\s*"/;
const CONTENT_VALUE_STANDARD = /"content"\s*:\s*"([\s\S]*)/;

// ── Escaped-quote patterns (\"key\":\"value\") ──────────────────────────
const FP_ESCAPED = /\\?"(?:filePath|file_path|path|filename|file_name|file)\\?"\s*:\s*\\?"([^"\\]+)\\?"/;
const CONTENT_START_ESCAPED = /\\?"content\\?"\s*:\s*\\?"/;
const CONTENT_VALUE_ESCAPED = /\\?"content\\?"\s*:\s*\\?"([\s\S]*)/;

/**
 * Match a filePath field (or alias) in text.
 * Tries standard quotes first, then escaped quotes.
 * @param {string} text
 * @returns {RegExpMatchArray|null}
 */
function matchFilePathInText(text) {
  return text.match(FP_STANDARD) || text.match(FP_ESCAPED) || null;
}

/**
 * Match the START of a "content" field in text (no capture of value).
 * Returns match with .index for position-based extraction.
 * Tries standard quotes first, then escaped quotes.
 * @param {string} text
 * @returns {RegExpMatchArray|null}
 */
function matchContentStartInText(text) {
  return text.match(CONTENT_START_STANDARD) || text.match(CONTENT_START_ESCAPED) || null;
}

/**
 * Match a "content" field and capture everything after the opening quote.
 * [1] = captured content value (to end of string).
 * Tries standard quotes first, then escaped quotes.
 * @param {string} text
 * @returns {RegExpMatchArray|null}
 */
function matchContentValueInText(text) {
  return text.match(CONTENT_VALUE_STANDARD) || text.match(CONTENT_VALUE_ESCAPED) || null;
}

module.exports = { matchFilePathInText, matchContentStartInText, matchContentValueInText };
