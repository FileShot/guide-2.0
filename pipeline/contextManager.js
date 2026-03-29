/**
 * Context Manager — Post-loop history maintenance functions.
 *
 * NOTE: This is NOT the old proactive rotation contextManager that was removed
 * (the one that destroyed KV cache at 35/50/65/80% thresholds). That system
 * is replaced by Solution A (nativeContextStrategy.js).
 *
 * This module provides three post-loop maintenance functions used by agenticLoop.js:
 *   1. postLoopCompaction — collapse intermediate entries after the loop completes
 *   2. shouldSummarize — check if context usage warrants summarization
 *   3. summarizeHistory — generate and inject a summary to preserve context health
 *
 * These operate AFTER the agentic loop finishes (not during generation).
 * They prepare the chatHistory for the NEXT user message, not the current one.
 */
'use strict';

const { estimateTokens } = require('./rollingSummary');

/**
 * Post-loop compaction: collapse intermediate tool result entries in chatHistory.
 *
 * During an agentic loop with many iterations, the chatHistory accumulates
 * user messages (tool results, continuation directives) and model responses
 * for each iteration. These intermediate entries are valuable during the loop
 * (the model needs them for context) but bloat history for future turns.
 *
 * This function compresses intermediate entries (between the original user
 * message and the final model response) into a compact summary, preserving
 * the conversation's meaning while freeing context tokens.
 *
 * @param {object} llmEngine — The LLM engine instance (owns chatHistory)
 * @param {string} originalMessage — The user's original message text
 * @param {string} fullResponseText — The complete accumulated response
 * @param {number} preLoopLen — chatHistory.length before the loop started
 */
function postLoopCompaction(llmEngine, originalMessage, fullResponseText, preLoopLen) {
  if (!llmEngine || !llmEngine.chatHistory) return;

  const history = llmEngine.chatHistory;

  // Nothing to compact if the loop only added 0-2 entries (single turn, no tool calls)
  const addedEntries = history.length - preLoopLen;
  if (addedEntries <= 4) return;

  // Identify boundaries:
  // - System message is always index 0
  // - Pre-loop entries (0..preLoopLen-1) are untouched
  // - Loop entries (preLoopLen..end) are candidates for compaction
  const loopStart = preLoopLen;
  const loopEntries = history.slice(loopStart);

  // Count tool calls and continuations in the loop entries
  let toolCallCount = 0;
  let continuationCount = 0;
  const toolNames = new Set();
  const filesWritten = new Set();

  for (const entry of loopEntries) {
    if (entry.type === 'user' && typeof entry.text === 'string') {
      if (entry.text.includes('Tool Execution Results') || entry.text.includes('Tool result')) {
        toolCallCount++;
      }
      if (entry.text.includes('Continue') || entry.text.includes('continue')) {
        continuationCount++;
      }
    }
    if (entry.type === 'model' && entry.response) {
      for (const seg of entry.response) {
        if (typeof seg === 'string') {
          const toolMatches = seg.matchAll(/"tool"\s*:\s*"([^"]+)"/g);
          for (const m of toolMatches) {
            toolNames.add(m[1]);
            if (m[1] === 'write_file' || m[1] === 'append_to_file') {
              const fpMatch = seg.match(/"filePath"\s*:\s*"([^"]+)"/);
              if (fpMatch) filesWritten.add(fpMatch[1]);
            }
          }
        }
      }
    }
  }

  // Only compact if there were significant intermediate entries
  // (3+ tool calls or 2+ continuations means the loop did real work)
  if (toolCallCount < 3 && continuationCount < 2) return;

  // Build a compact summary of what happened during the loop
  const summaryParts = [];
  if (toolCallCount > 0) {
    summaryParts.push(`${toolCallCount} tool call(s): ${[...toolNames].join(', ')}`);
  }
  if (filesWritten.size > 0) {
    summaryParts.push(`Files: ${[...filesWritten].join(', ')}`);
  }
  if (continuationCount > 0) {
    summaryParts.push(`${continuationCount} continuation(s)`);
  }

  const summaryText = `[Agentic loop completed: ${summaryParts.join('. ')}]`;

  // Keep: system message + pre-loop entries + original user message + summary + last 4 entries
  // The last 4 entries are the most recent context the model needs for continuity
  const keepTail = Math.min(4, loopEntries.length);
  const recentEntries = loopEntries.slice(-keepTail);

  // Rebuild history: preserve everything before the loop, add compact summary, keep recent
  const newHistory = history.slice(0, loopStart);

  // Find and keep the original user message from the loop entries
  const firstUserInLoop = loopEntries.find(e => e.type === 'user');
  if (firstUserInLoop) {
    newHistory.push(firstUserInLoop);
  }

  // Add compact summary as a model response
  if (loopEntries.length > keepTail + 2) {
    newHistory.push({ type: 'model', response: [summaryText] });
  }

  // Add recent entries
  for (const entry of recentEntries) {
    // Avoid duplicating the first user message
    if (entry === firstUserInLoop) continue;
    newHistory.push(entry);
  }

  const removed = history.length - newHistory.length;
  if (removed > 0) {
    llmEngine.chatHistory = newHistory;
    // Invalidate KV cache — the compacted history no longer matches the evaluated sequence
    llmEngine.lastEvaluation = null;
    console.log(`[ContextManager] postLoopCompaction: compacted ${removed} entries (${history.length} -> ${newHistory.length}). ${summaryText}`);
  }
}

/**
 * Determine if context usage warrants proactive summarization.
 *
 * Called after the agentic loop completes. If context usage is high,
 * summarizing now (while we have idle time before the next user message)
 * prevents context pressure during the next turn.
 *
 * @param {number} ctxUsed — Tokens currently used in the context
 * @param {number} totalCtx — Total context window size in tokens
 * @param {number} historyLength — Number of entries in chatHistory
 * @returns {boolean} True if summarization is recommended
 */
function shouldSummarize(ctxUsed, totalCtx, historyLength) {
  if (!ctxUsed || !totalCtx || totalCtx <= 0) return false;

  const usagePct = ctxUsed / totalCtx;

  // Summarize if context usage exceeds 60% AND there are enough history entries
  // to make summarization worthwhile (need at least 6 entries to compress)
  if (usagePct > 0.60 && historyLength > 6) return true;

  // Also summarize if history is very long regardless of token usage
  // (many short exchanges can add up without high token counts)
  if (historyLength > 20) return true;

  return false;
}

/**
 * Summarize conversation history to free context space.
 *
 * Uses the ConversationSummarizer to generate a compact summary of older
 * conversation turns, then replaces them in chatHistory with the summary.
 * This preserves the conversation's meaning while freeing tokens for
 * future turns.
 *
 * @param {object} llmEngine — The LLM engine instance
 * @param {object} stream — The StreamHandler for UI updates
 * @param {object} summarizer — ConversationSummarizer instance
 */
async function summarizeHistory(llmEngine, stream, summarizer) {
  if (!llmEngine || !llmEngine.chatHistory || !summarizer) return;

  const history = llmEngine.chatHistory;
  if (history.length <= 4) return; // Nothing worth summarizing

  // Generate summary from the summarizer's accumulated state
  const summaryText = summarizer.generateQuickSummary
    ? summarizer.generateQuickSummary()
    : (summarizer.generateSummary ? summarizer.generateSummary(500) : null);

  if (!summaryText || summaryText.length < 20) return;

  // Keep: system message (index 0) + last 4 entries (recent context)
  const systemMsg = history[0]?.type === 'system' ? history[0] : null;
  const recentCount = Math.min(4, history.length - 1);
  const recentEntries = history.slice(-recentCount);

  const newHistory = [];
  if (systemMsg) newHistory.push(systemMsg);

  // Inject summary as a system message (not user — to avoid confusing the model
  // into thinking the user said this)
  newHistory.push({ type: 'system', text: summaryText });

  // Add recent entries
  newHistory.push(...recentEntries);

  const removed = history.length - newHistory.length;
  if (removed > 0) {
    llmEngine.chatHistory = newHistory;
    llmEngine.lastEvaluation = null;
    console.log(`[ContextManager] summarizeHistory: replaced ${removed} entries with summary (${history.length} -> ${newHistory.length})`);
  }
}

module.exports = { postLoopCompaction, shouldSummarize, summarizeHistory };
