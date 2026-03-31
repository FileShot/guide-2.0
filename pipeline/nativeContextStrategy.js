/**
 * Native Context Strategy for node-llama-cpp's contextShift hook
 *
 * This is the SOLE context management system for guIDE. node-llama-cpp calls
 * this strategy when context fills during generation. The model's current
 * partial response (including any in-progress tool call) is preserved in the
 * KV cache; this function decides what OLD history to keep/drop/truncate.
 *
 * CRITICAL: The returned chatHistory MUST fit within maxTokensCount.
 * If it doesn't, node-llama-cpp falls back to its default strategy which
 * is NOT file-aware. Always verify fit before returning.
 *
 * @module nativeContextStrategy
 */

const log = require('../logger');
const { matchFilePathInText, matchContentValueInText } = require('./regexHelpers');

const CONFIG = {
  // Conservative chars-per-token estimate for budget calculations.
  // Using 3.5 is safe for English/code — real ratio is often higher (4+).
  CHARS_PER_TOKEN: 3.5,

  // Target this fraction of maxTokensCount to leave safety margin.
  // node-llama-cpp checks fit AFTER our strategy returns; being under budget
  // prevents fallback to the default strategy.
  // T21-Fix: raised from 0.85 to 0.90 — the previous 15% margin was too conservative
  // for small contexts (8K), causing 56% truncation of the model's in-progress output.
  TARGET_BUDGET_FRACTION: 0.90,

  // Maximum chars for the context summary injected as a system message.
  MAX_SUMMARY_CHARS: 1500,

  DEBUG: true,
};

// ─── Helpers ─────────────────────────────────────────────

/**
 * Estimate token count for a string.
 * Conservative: rounds UP so we stay under budget.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CONFIG.CHARS_PER_TOKEN);
}

/**
 * Estimate token count for a single chatHistory item.
 * Handles system, user, and model item types.
 */
function estimateItemTokens(item) {
  if (!item) return 0;
  if (item.type === 'system' || item.type === 'user') {
    return estimateTokens(typeof item.text === 'string' ? item.text : JSON.stringify(item.text)) + 10; // +10 for role/template tokens
  }
  if (item.type === 'model' && item.response) {
    let total = 10; // role overhead
    for (const seg of item.response) {
      if (typeof seg === 'string') {
        total += estimateTokens(seg);
      } else if (seg && seg.type === 'functionCall') {
        // Function call: name + stringified params
        total += estimateTokens(seg.name || '') + estimateTokens(JSON.stringify(seg.params || {}));
        if (seg.rawCall) total += estimateTokens(JSON.stringify(seg.rawCall));
      } else if (seg && seg.type === 'functionCallResult') {
        total += estimateTokens(JSON.stringify(seg.result || ''));
      }
    }
    return total;
  }
  return estimateTokens(JSON.stringify(item));
}

/**
 * Truncate a user/system item's text to fit within a character budget.
 * Keeps the first `headChars` and last `tailChars`, replacing the middle with "[...]".
 */
function truncateItemText(item, maxChars) {
  const text = typeof item.text === 'string' ? item.text : JSON.stringify(item.text);
  if (text.length <= maxChars) return { ...item };
  const headChars = Math.floor(maxChars * 0.15);
  const tailChars = maxChars - headChars - 10; // 10 for "[...]" marker
  const truncated = text.slice(0, headChars) + '\n[...]\n' + text.slice(-Math.max(tailChars, 0));
  return { ...item, text: truncated };
}

/**
 * Truncate a model response item to fit within a character budget.
 * Keeps the TAIL (most recent output) since that's what the model needs
 * for coherent continuation.
 *
 * Special case (R13-Fix-D1): When the model is mid-tool-call (the response
 * contains an in-progress JSON string like '{"tool":"write_file",...'), keeping
 * the tail of that JSON is destructive — the model receives a fragment like
 * `...rest of HTML here..."}` as its own prior output and stalls or emits EOS.
 * Instead, preserve only the pre-JSON text prefix (the model's "I'll create..."
 * intro) and drop the partial JSON entirely. This gives the model a clean
 * anchor to resume from.
 */
function truncateModelItem(item, maxChars) {
  if (!item || item.type !== 'model' || !item.response) return item;

  // ── R13-Fix-D1: Detect in-progress tool call JSON in response segments ──
  // If any string segment looks like a partial tool call JSON, keep only the
  // text segments that appear BEFORE the first JSON segment. This prevents
  // the model from seeing its own mid-JSON output as a continuation anchor.
  //
  // R30-Fix: Also detect tool call JSON that appears MID-SEGMENT (not just at start).
  // When the model outputs prose intro + JSON in the same string segment (e.g.,
  // "I'll create a complete periodic table...\n\n```json\n{"tool":"write_file",...}"),
  // startsWith fails because the segment starts with prose. We use indexOf/regex
  // to find JSON anywhere in the segment and split it: prose prefix goes to
  // prefixSegs, JSON portion goes to T42-Fix for file content extraction.
  let firstJsonSegIdx = item.response.findIndex(seg => {
    if (typeof seg !== 'string') return false;
    const trimmed = seg.trimStart();
    return trimmed.startsWith('{"tool"') || trimmed.startsWith('{"tool_calls"') ||
           trimmed.startsWith('{"function"') || trimmed.startsWith('{"name"') ||
           trimmed.startsWith('```json\n{"tool') || trimmed.startsWith('```json\n{"function');
  });

  // R30-Fix: If startsWith didn't match, search for embedded tool call JSON
  // within string segments. This handles the common case where the model outputs
  // prose intro text before the JSON tool call in the same response segment.
  let embeddedJsonSplitPos = -1;
  if (firstJsonSegIdx < 0) {
    for (let si = 0; si < item.response.length; si++) {
      const seg = item.response[si];
      if (typeof seg !== 'string') continue;
      // Look for tool call JSON pattern anywhere in the segment
      const jsonMatch = seg.match(/\{"tool"\s*:\s*"(write_file|create_file|append_to_file|edit_file)"/);
      if (jsonMatch) {
        // Also check for fenced variant: ```json\n{"tool"...
        const fencedMatch = seg.match(/```(?:json|tool)?\s*\n\s*\{"tool"\s*:\s*"(write_file|create_file|append_to_file|edit_file)"/);
        const splitAt = fencedMatch ? seg.indexOf(fencedMatch[0]) : jsonMatch.index;
        if (splitAt > 0) {
          // JSON is embedded mid-segment — split the segment
          embeddedJsonSplitPos = splitAt;
          firstJsonSegIdx = si;
          if (CONFIG.DEBUG) log.info(`[NativeCtxShift] R30-Fix: Found embedded tool call JSON at char ${splitAt} in segment ${si} (${seg.length} chars total)`);
        } else {
          // JSON is at position 0 — treat as if startsWith matched
          firstJsonSegIdx = si;
        }
        break;
      }
    }
  }

  if (firstJsonSegIdx >= 0) {
    // ── T42-Fix: Instead of dropping the tool call JSON entirely (which erased
    // ALL file content awareness from the model's context, causing it to restart
    // files from scratch), extract the content field value and keep a condensed
    // summary. The model retains awareness of what it was writing — file path,
    // line count, and the tail of the content — without the confusing partial
    // JSON structure that caused R13-Fix-D1's stalls/EOS issues.
    let prefixSegs = firstJsonSegIdx > 0 ? item.response.slice(0, firstJsonSegIdx) : [];
    let jsonSeg = item.response[firstJsonSegIdx];

    // R30-Fix: When the tool call JSON was embedded mid-segment, split the segment.
    // The prose before the JSON becomes an additional prefix segment.
    if (embeddedJsonSplitPos > 0 && typeof jsonSeg === 'string') {
      const prosePart = jsonSeg.slice(0, embeddedJsonSplitPos);
      jsonSeg = jsonSeg.slice(embeddedJsonSplitPos);
      prefixSegs = [...prefixSegs, prosePart];
      if (CONFIG.DEBUG) log.info(`[NativeCtxShift] R30-Fix: Split segment — prose prefix ${prosePart.length} chars, JSON portion ${jsonSeg.length} chars`);
    }

    let fileSummary = '';
    if (typeof jsonSeg === 'string') {
      const fpMatch = matchFilePathInText(jsonSeg);
      const contentMatch = matchContentValueInText(jsonSeg);
      if (fpMatch && contentMatch) {
        const rawContent = contentMatch[1];
        // Unescape JSON string to get actual file content
        const content = rawContent
          .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const lineCount = (content.match(/\n/g) || []).length + 1;
        // R28-2: Calculate available budget for tail instead of hardcoded 600.
        // The description text (fileSummary header) takes ~260 chars. Prefix segments
        // take some space too. Use the remainder of maxChars for the tail.
        // This increases retention from ~600 chars (5%) to fill the available budget
        // (~8000 chars), giving the model 13x more context to continue coherently.
        let prefixChars = 0;
        for (const s of prefixSegs) prefixChars += typeof s === 'string' ? s.length : JSON.stringify(s).length;
        const descriptionOverhead = 300; // conservative estimate for the "[I was writing..." header text
        const headBudget = 200; // R32-Fix Phase C: budget for file head (first few lines)
        const head = content.split('\n').slice(0, 5).join('\n');
        const headText = head.length > headBudget ? head.slice(0, headBudget) : head;
        const availableForTail = Math.max(600, maxChars - prefixChars - descriptionOverhead - headText.length - 30);
        const tail = content.slice(-availableForTail);
        fileSummary = `\n[I was writing "${fpMatch[1]}" with write_file — ${lineCount} lines written so far. ` +
          `The file is INCOMPLETE. I must continue from where I left off using append_to_file. ` +
          `Do NOT restart the file. Do NOT use write_file.\n` +
          `File starts with:\n${headText}\n...\n` +
          `Last content written:\n${tail}]`;
        if (CONFIG.DEBUG) log.info(`[NativeCtxShift] T42-Fix/R28-2/R32-C: Preserved file content summary for "${fpMatch[1]}" (${lineCount} lines, head=${headText.length} chars, tail=${tail.length} chars, budget=${maxChars}, available=${availableForTail})`);
      }
    }

    // If no content could be extracted, fall back to keeping just the prefix
    if (!fileSummary) {
      if (firstJsonSegIdx > 0) {
        if (CONFIG.DEBUG) log.info(`[NativeCtxShift] R13-D1: No content extracted — kept text prefix only`);
        const truncated = truncateModelItemSegments(prefixSegs, maxChars);
        return { ...item, response: truncated };
      }
      if (CONFIG.DEBUG) log.info(`[NativeCtxShift] R13-D1: No content extracted, no prefix — returning empty`);
      return { ...item, response: [] };
    }

    const result = [...prefixSegs, fileSummary];
    let totalChars = 0;
    for (const s of result) totalChars += typeof s === 'string' ? s.length : JSON.stringify(s).length;
    if (totalChars > maxChars) {
      return { ...item, response: truncateModelItemSegments(result, maxChars) };
    }
    return { ...item, response: result };
  }

  // ── Normal truncation: keep the tail of the accumulated segments ──
  const truncatedSegs = truncateModelItemSegments(item.response, maxChars);
  return { ...item, response: truncatedSegs };
}

/**
 * Internal: truncate an array of model response segments to fit maxChars,
 * keeping segments from the END (most recent).
 */
function truncateModelItemSegments(segments, maxChars) {
  // Serialize all response segments to measure
  let totalChars = 0;
  const segSizes = segments.map(seg => {
    const size = typeof seg === 'string' ? seg.length : JSON.stringify(seg).length;
    totalChars += size;
    return size;
  });

  if (totalChars <= maxChars) return [...segments];

  // Keep segments from the END (most recent). Drop/truncate from the start.
  const newResponse = [];
  let budget = maxChars;

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const size = segSizes[i];
    if (size <= budget) {
      newResponse.unshift(seg);
      budget -= size;
    } else if (budget > 100 && typeof seg === 'string') {
      // Truncate this string segment — keep the tail
      newResponse.unshift(seg.slice(-(budget - 20)));
      budget = 0;
    }
    // else: skip this segment entirely
    if (budget <= 0) break;
  }

  return newResponse;
}

/**
 * Generate a concise summary of dropped history items.
 * Zero-LLM-cost: extracts key user requests and model actions.
 * R39-B4: Budget-proportional user message preservation — keeps proportional text
 * from ALL dropped user messages instead of just the first sentence.
 */
function summarizeDroppedItems(items) {
  if (!items || items.length === 0) return '';
  const parts = [];

  // Count user messages to calculate per-message budget
  const userMessages = items.filter(i => i.type === 'user' && i.text);
  const totalBudgetChars = 3000; // total chars available for user message summaries
  const perMessageBudget = userMessages.length > 0
    ? Math.max(100, Math.min(600, Math.floor(totalBudgetChars / userMessages.length)))
    : 200;

  for (const item of items) {
    if (item.type === 'user' && item.text) {
      const text = (typeof item.text === 'string' ? item.text : '').trim();
      if (text.length <= 10) continue;
      // Keep up to perMessageBudget chars, truncating at word boundary
      let kept = text.slice(0, perMessageBudget);
      if (kept.length < text.length) {
        const lastSpace = kept.lastIndexOf(' ');
        if (lastSpace > perMessageBudget * 0.5) kept = kept.slice(0, lastSpace);
        kept += '...';
      }
      parts.push(`User: ${kept}`);
    } else if (item.type === 'model' && item.response) {
      const toolCalls = item.response.filter(r => r && r.type === 'functionCall');
      for (const call of toolCalls) {
        if (call.name === 'write_file' && call.params?.filePath) {
          const content = call.params.content || '';
          const lines = content ? (content.match(/\n/g) || []).length + 1 : '?';
          // Include a brief content excerpt so the model retains structural context
          const excerpt = content.split('\n').slice(0, 5).join(' ').trim().slice(0, 120);
          const excerptSuffix = excerpt ? ` | starts: ${excerpt}` : '';
          parts.push(`Wrote ${call.params.filePath} (${lines} lines)${excerptSuffix}`);
        } else if (call.name === 'append_to_file' && call.params?.filePath) {
          parts.push(`Appended to ${call.params.filePath}`);
        } else if (call.name === 'read_file' && call.params?.filePath) {
          parts.push(`Read ${call.params.filePath}`);
        } else if (call.name) {
          parts.push(`Tool: ${call.name}`);
        }
      }
      // Also capture brief text responses (non-tool-call model text)
      const textParts = item.response.filter(r => typeof r === 'string');
      if (textParts.length > 0 && toolCalls.length === 0) {
        const modelText = textParts.join('').trim();
        if (modelText.length > 20) {
          parts.push(`Assistant: ${modelText.slice(0, 150)}${modelText.length > 150 ? '...' : ''}`);
        }
      }
    }
  }

  const unique = [...new Set(parts)];
  return unique.slice(0, 15).join('\n');
}

/**
 * Extract file progress info from the full chat history.
 * Tracks the LATEST write to each file path.
 */
function extractFileProgress(chatHistory) {
  const files = {};
  for (const item of chatHistory) {
    if (item.type !== 'model' || !item.response) continue;
    for (const seg of item.response) {
      if (!seg || seg.type !== 'functionCall') continue;
      if ((seg.name === 'write_file' || seg.name === 'append_to_file') && seg.params?.filePath) {
        const path = seg.params.filePath;
        const content = seg.params.content || '';
        const lines = (content.match(/\n/g) || []).length + 1;
        if (!files[path]) files[path] = { lines: 0, chars: 0, writes: 0 };
        if (seg.name === 'write_file') {
          files[path].lines = lines;
          files[path].chars = content.length;
        } else {
          files[path].lines += lines;
          files[path].chars += content.length;
        }
        files[path].writes++;
      }
    }
  }
  return files;
}

/**
 * Detect if the model is currently in the middle of writing a file.
 * R30-Fix: Scans backwards through ALL model items in history, not just the
 * last item. When the agentic loop injects a continuation message (user type)
 * after a file write iteration, the last item is that user message — not the
 * model response containing write_file. Checking only the last item returns
 * null, causing the entire file-aware budget/summary path to be skipped.
 * Now scans backwards and checks the most recent model response found.
 */
function detectActiveFileGeneration(chatHistory) {
  // R30-Fix: Walk backwards to find the most recent model response
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const item = chatHistory[i];
    if (item.type !== 'model' || !item.response) continue;

    for (const seg of item.response) {
      if (typeof seg === 'string') {
        // Look for partial tool call JSON in the response text
        const writeMatch = seg.match(/"tool"\s*:\s*"write_file".*?"filePath"\s*:\s*"([^"]+)"/s);
        if (writeMatch) return { filePath: writeMatch[1], isPartial: true };
        // R30-Fix: Also detect the T42-Fix condensed summary format
        // e.g. '[I was writing "periodic-table.html" with write_file — 432 lines'
        const summaryMatch = seg.match(/\[I was writing "([^"]+)" with write_file/);
        if (summaryMatch) return { filePath: summaryMatch[1], isPartial: true };
      }
      if (seg && seg.type === 'functionCall' && seg.name === 'write_file') {
        return { filePath: seg.params?.filePath, isPartial: false };
      }
    }
    // Only check the most recent model response — don't go further back
    break;
  }
  return null;
}

// ─── Main Strategy ───────────────────────────────────────

/**
 * The main context shift strategy function.
 * Called by node-llama-cpp when the context window fills during generation.
 *
 * Strategy:
 *   1. Always keep system prompt (attention sink)
 *   2. Always keep the last item (current model response / most recent turn)
 *   3. Fill remaining budget with recent turns, newest first
 *   4. Truncate oversized items to fit budget
 *   5. Inject compact summary of dropped items
 *   6. Verify total fits within maxTokensCount
 */
async function nativeContextShiftStrategy(options) {
  const { chatHistory, maxTokensCount, tokenizer, chatWrapper, lastShiftMetadata } = options;

  if (CONFIG.DEBUG) {
    log.info(`[NativeCtxShift] Context shift triggered — ${chatHistory.length} items, budget ${maxTokensCount} tokens`);
  }

  // Edge case: 2 items or fewer — nothing to compress
  if (chatHistory.length <= 2) {
    return { chatHistory: [...chatHistory], metadata: { compressed: false } };
  }

  // ── Step 1: Calculate working budget in characters ──────
  const charBudget = Math.floor(maxTokensCount * CONFIG.TARGET_BUDGET_FRACTION * CONFIG.CHARS_PER_TOKEN);

  // ── Step 2: Identify must-keep items ────────────────────
  const systemItem = chatHistory[0]?.type === 'system' ? chatHistory[0] : null;
  const lastItem = chatHistory[chatHistory.length - 1]; // current model response or latest turn
  const middleItems = chatHistory.slice(systemItem ? 1 : 0, chatHistory.length - 1);

  // Measure must-keep items
  let systemChars = 0;
  if (systemItem) {
    const sysText = typeof systemItem.text === 'string' ? systemItem.text : JSON.stringify(systemItem.text);
    systemChars = sysText.length + 20; // overhead
  }

  let lastItemChars = 0;
  if (lastItem.type === 'model' && lastItem.response) {
    for (const seg of lastItem.response) {
      lastItemChars += typeof seg === 'string' ? seg.length : JSON.stringify(seg).length;
    }
  } else if (lastItem.type === 'user' || lastItem.type === 'system') {
    const t = typeof lastItem.text === 'string' ? lastItem.text : JSON.stringify(lastItem.text);
    lastItemChars = t.length;
  }
  lastItemChars += 20; // overhead

  if (CONFIG.DEBUG) {
    log.info(`[NativeCtxShift] Char budget: ${charBudget}, system: ${systemChars}, lastItem: ${lastItemChars}`);
  }

  // ── Step 3: If last item alone exceeds budget, truncate it ──
  let keptLastItem = lastItem;
  // T21-Fix: When model is actively writing a file, give it at least 70% of
  // the char budget so it retains enough structural context to continue coherently.
  // Without this, a 21K-char model item gets chopped to 9.5K (56% loss) and the
  // model loses track of HTML structure, function definitions, etc.
  const activeFile = detectActiveFileGeneration(chatHistory);
  const summaryReserveBase = Math.min(CONFIG.MAX_SUMMARY_CHARS, 800); // T21: tighter summary cap
  let maxLastItemChars;
  if (activeFile) {
    // Mid-file: give the last item at least 70% of AVAILABLE budget (after system).
    // T27-Fix: Previously used Math.floor(charBudget * 0.70) which computed 70% of
    // the TOTAL budget including system prompt space. When the system prompt is large
    // (e.g. 8257 chars, 43% of charBudget), system + 70% total = 113% of budget.
    // node-llama-cpp rejected the over-budget history with "context size too small."
    // Fix: compute 70% floor relative to available space (charBudget - systemChars).
    maxLastItemChars = Math.max(
      charBudget - systemChars - summaryReserveBase,
      Math.floor((charBudget - systemChars) * 0.70)
    );
    if (CONFIG.DEBUG) log.info(`[NativeCtxShift] T21/T27-Fix: active file "${activeFile.filePath}" — maxLastItemChars set to ${maxLastItemChars}`);
  } else {
    maxLastItemChars = charBudget - systemChars - 500; // original calculation
  }
  if (lastItemChars > maxLastItemChars && maxLastItemChars > 200) {
    if (lastItem.type === 'model') {
      keptLastItem = truncateModelItem(lastItem, maxLastItemChars);
      if (CONFIG.DEBUG) log.info(`[NativeCtxShift] Truncated last model item: ${lastItemChars} → ~${maxLastItemChars} chars`);
    } else {
      keptLastItem = truncateItemText(lastItem, maxLastItemChars);
      if (CONFIG.DEBUG) log.info(`[NativeCtxShift] Truncated last item: ${lastItemChars} → ~${maxLastItemChars} chars`);
    }
    // T44-Fix: Measure the ACTUAL size of the truncated item, not the budget cap.
    // The T42-Fix condenses tool call JSON into a ~1K-char summary, which is much
    // smaller than maxLastItemChars (~16K). Using the budget cap as the size starves
    // remaining budget to ~800 chars, causing continuation messages to be truncated
    // or dropped during subsequent context shifts. Using actual size preserves budget
    // for the continuation directive.
    let actualChars = 20; // overhead
    if (keptLastItem.type === 'model' && keptLastItem.response) {
      for (const seg of keptLastItem.response) {
        actualChars += typeof seg === 'string' ? seg.length : JSON.stringify(seg).length;
      }
    } else if (keptLastItem.text) {
      actualChars += (typeof keptLastItem.text === 'string' ? keptLastItem.text : JSON.stringify(keptLastItem.text)).length;
    }
    lastItemChars = actualChars;
    if (CONFIG.DEBUG) log.info(`[NativeCtxShift] T44-Fix: actual truncated size = ${actualChars} chars (budget was ${maxLastItemChars})`);
  }

  // ── Step 4: Fill remaining budget with recent turns ─────
  let remainingBudget = charBudget - systemChars - lastItemChars;
  // Reserve space for the summary message we'll inject
  const summaryReserve = Math.min(CONFIG.MAX_SUMMARY_CHARS, Math.floor(remainingBudget * 0.3));
  remainingBudget -= summaryReserve;

  const keptMiddle = [];
  const droppedMiddle = [];

  // Walk backwards through middle items (newest first)
  for (let i = middleItems.length - 1; i >= 0; i--) {
    const item = middleItems[i];
    let itemChars;
    if (item.type === 'model' && item.response) {
      itemChars = 0;
      for (const seg of item.response) {
        itemChars += typeof seg === 'string' ? seg.length : JSON.stringify(seg).length;
      }
    } else {
      const t = typeof item.text === 'string' ? item.text : JSON.stringify(item.text || '');
      itemChars = t.length;
    }
    itemChars += 20; // overhead per item

    if (itemChars <= remainingBudget) {
      // Item fits — keep it entirely
      keptMiddle.unshift(item);
      remainingBudget -= itemChars;
    } else if (remainingBudget > 200) {
      // Item too large but we have some budget — truncate it
      if (item.type === 'model') {
        keptMiddle.unshift(truncateModelItem(item, remainingBudget - 20));
      } else {
        keptMiddle.unshift(truncateItemText(item, remainingBudget - 20));
      }
      remainingBudget = 0;
      // Everything before this is dropped
      droppedMiddle.unshift(...middleItems.slice(0, i));
      break;
    } else {
      // No budget left — drop everything remaining
      droppedMiddle.unshift(...middleItems.slice(0, i + 1));
      break;
    }
  }

  // If we finished the loop without breaking, no items were dropped from the front
  if (droppedMiddle.length === 0 && keptMiddle.length < middleItems.length) {
    // Some items weren't processed (loop ended naturally)
    const processedCount = keptMiddle.length;
    for (let i = 0; i < middleItems.length - processedCount; i++) {
      droppedMiddle.push(middleItems[i]);
    }
  }

  // ── Step 5: Build context summary ──────────────────────
  const fileProgress = extractFileProgress(chatHistory);
  // activeFile already declared in Step 3
  const droppedSummary = summarizeDroppedItems(droppedMiddle);

  let summaryText = '';
  if (droppedSummary || Object.keys(fileProgress).length > 0 || activeFile) {
    const parts = ['[Context compressed — earlier conversation dropped]'];

    if (droppedSummary) {
      parts.push('Previous actions:\n' + droppedSummary);
    }

    if (Object.keys(fileProgress).length > 0) {
      parts.push('File progress:\n' +
        Object.entries(fileProgress)
          .map(([p, info]) => `- ${p}: ${info.lines} lines, ${info.writes} write(s)`)
          .join('\n'));
    }

    if (activeFile) {
      parts.push(`ACTIVE: Currently writing "${activeFile.filePath}" — continue from where you left off.`);
    }

    parts.push('Continue from where you left off. Do NOT restart completed work.');
    summaryText = parts.join('\n\n');

    // Cap summary to budget
    if (summaryText.length > summaryReserve) {
      summaryText = summaryText.slice(0, summaryReserve - 10) + '\n[...]';
    }
  }

  // ── Step 6: Assemble new history ───────────────────────
  const newHistory = [];

  if (systemItem) newHistory.push(systemItem);

  if (summaryText) {
    newHistory.push({ type: 'system', text: summaryText });
  }

  newHistory.push(...keptMiddle);
  newHistory.push(keptLastItem);

  if (CONFIG.DEBUG) {
    log.info(`[NativeCtxShift] Result: ${newHistory.length} items (kept ${keptMiddle.length} middle, dropped ${droppedMiddle.length})`);
    if (activeFile) log.info(`[NativeCtxShift] Active file generation: ${activeFile.filePath}`);
  }

  return {
    chatHistory: newHistory,
    metadata: {
      compressed: true,
      originalLength: chatHistory.length,
      newLength: newHistory.length,
      droppedCount: droppedMiddle.length,
      keptMiddleCount: keptMiddle.length,
      activeFile: activeFile?.filePath || null,
      fileProgress,
      shiftNumber: (lastShiftMetadata?.shiftNumber || 0) + 1,
      timestamp: Date.now(),
    },
  };
}

/**
 * Calculate the recommended context shift size.
 * This is the number of tokens to FREE when context is full.
 * node-llama-cpp subtracts this from contextSize to get maxTokensCount.
 *
 * Larger values = more aggressive compression but more room for generation.
 * Must be large enough that after compression, there's meaningful room to
 * continue generating (at least 1K tokens).
 */
function getContextShiftSize(sequence) {
  const contextSize = sequence?.context?.contextSize || 8192;

  if (contextSize <= 4096) return Math.floor(contextSize * 0.30); // 30% for tiny contexts
  if (contextSize <= 8192) return Math.floor(contextSize * 0.25); // 25% for small
  if (contextSize <= 16384) return Math.floor(contextSize * 0.20); // 20% for medium
  return Math.floor(contextSize * 0.15); // 15% for large
}

/**
 * Build context shift options for node-llama-cpp.
 * Sets engine._contextShiftFiredDuringGen = true when a shift occurs,
 * allowing the agentic loop to detect post-shift premature EOS.
 */
function buildContextShiftOptions(llmEngine) {
  return {
    size: (sequence) => getContextShiftSize(sequence),
    strategy: async (options) => {
      // Signal to the agentic loop that a context shift happened during this generation
      if (llmEngine) llmEngine._contextShiftFiredDuringGen = true;

      // R13-Fix-A: Record which file was actively being generated at shift time.
      // The agentic loop reads _contextShiftActiveFile after generation to know
      // which file to checkpoint after a post-shift EOS/stall.
      if (llmEngine) {
        const activeFile = detectActiveFileGeneration(options.chatHistory || []);
        llmEngine._contextShiftActiveFile = activeFile ? activeFile.filePath : null;
        if (activeFile) {
          log.info(`[NativeCtxStrategy] R13-Fix-A: context shift during active write_file("${activeFile.filePath}") — stored in _contextShiftActiveFile`);
        }
      }

      return nativeContextShiftStrategy(options);
    },
    lastEvaluationMetadata: llmEngine?.lastEvaluation?.contextShiftMetadata || null,
  };
}

module.exports = {
  nativeContextShiftStrategy,
  buildContextShiftOptions,
  getContextShiftSize,
  CONFIG,
};
