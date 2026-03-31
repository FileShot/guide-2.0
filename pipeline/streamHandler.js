/**
 * StreamHandler — Token streaming with look-ahead buffer.
 *
 * Streams tokens to the UI in real time while preventing tool call JSON
 * (```json blocks) from leaking into the displayed response. When the
 * model starts outputting a tool call, the buffer holds those tokens
 * back and emits tool-generating progress events instead.
 */
'use strict';

// Regex to match filePath in raw tool call JSON — accepts all aliases that
// mcpToolServer._normalizeFsParams handles.
const FILE_PATH_RE = /"(?:filePath|file_path|path|filename|file_name|file)"\s*:\s*"([^"]+)"/;
const { matchFilePathInText, matchContentStartInText } = require('./regexHelpers');

class StreamHandler {
  constructor(mainWindow) {
    this._win = mainWindow;
    this._buffer = '';
    this._sent = 0;
    this._holdingToolCall = false;
    this._holdingFenced = false;  // D03/D07: true when hold triggered by ```json fence, false for raw JSON
    this._toolCallJson = '';
    this._continuationMeta = null; // Fix C: preserved filePath+tool across continuations
    this._contentStreamStarted = false; // true once we've started streaming file content to UI
    this._contentStreamedFlag = false; // set at finalize, readable by agenticLoop
    this._contentStreamSent = 0;        // how many chars of extracted content we've already sent
    this._contentContinuation = false;   // true when continuing content from a previous iteration
    this._contentResuming = false;       // T43-Fix: true when next content detection should skip fence opener
    this._contentHoldback = '';          // T58-Fix-C: last N chars held back to strip JSON closing syntax
    this._fileContentActive = false;     // R19: true when file-content events are being sent to frontend
    this._fileContentFilePath = null;    // R19: filePath of the currently active file content block
    this._suspenseBuffer = '';           // R35-L2: tokens buffered when _fileContentActive but no tool hold
    this._suspenseMode = false;          // R35-L2: true when suspense buffering is active
    this._keepFileContentAlive = false;  // R42-Fix-2: when true, finalize(false) won't kill _fileContentActive
  }

  /* ── Core send (safe against destroyed windows) ─────────── */
  _send(event, data) {
    if (this._win && !this._win.isDestroyed()) {
      this._win.webContents.send(event, data);
    }
  }

  /* ── Token handling with look-ahead buffer ──────────────── */

  /**
   * Called for every token the model produces.
   * Buffers tokens that might be the start of a ```json tool call block
   * and sends everything else to the UI immediately.
   */
  onToken(text) {
    this._buffer += text;

    // If we've already detected a tool call block, accumulate and stream content
    if (this._holdingToolCall) {
      this._toolCallJson += text;

      // D03/D07: Look-ahead validation for fenced ```json holds.
      // Real tool calls contain "tool": or "tool_calls": within first ~50 chars.
      // Code examples (```json blocks with non-tool content) do not.
      // After 80 chars without a tool call pattern, release as regular text.
      // R37-Step2: Also release non-fenced holds after 100 chars without tool pattern.
      // Continuation iterations set _holdingFenced=false, so without this check
      // tokens accumulate indefinitely with no release path.
      const holdLimit = this._holdingFenced ? 80 : 100;
      if (this._toolCallJson.length > holdLimit && !this._looksLikeToolCall()) {
        // R37-Step1: If _contentResuming, model is continuing raw file content
        // without JSON wrapper. Route tokens to file-content instead of llm-token.
        if (this._contentResuming && this._fileContentActive) {
          console.log(`[StreamHandler] R37-Step1: Raw continuation detected (${this._toolCallJson.length} chars) — routing to file-content for "${this._fileContentFilePath}"`);
          this._send('file-content-token', this._toolCallJson);
          this._cumulativeContentLen = (this._cumulativeContentLen || 0) + this._toolCallJson.length;
          this._holdingToolCall = false;
          this._holdingFenced = false;
          this._toolCallJson = '';
          // Stay in file-content mode — model is still writing
          this._contentStreamStarted = false;
          this._contentStreamSent = 0;
          this._sent = this._buffer.length;
          return;
        }
        const prefix = this._holdingFenced ? '```json' : '';
        this._send('llm-token', prefix + this._toolCallJson);
        this._holdingToolCall = false;
        this._holdingFenced = false;
        this._toolCallJson = '';
        this._contentStreamStarted = false;
        this._contentStreamSent = 0;
        this._sent = this._buffer.length;
        return;
      }

      // Stream file content to UI in real-time for write tools.
      // This ensures the user sees code being written immediately instead of
      // staring at a blank screen while the tool hold accumulates JSON.
      if (this._streamFileContent(text)) return;

      // For non-write tools or before content starts, emit tool progress metadata
      this._emitToolProgress();
      return;
    }

    const unsent = this._buffer.slice(this._sent);

    // Check if unsent text contains a complete ```json marker
    const jsonIdx = unsent.indexOf('```json');
    if (jsonIdx !== -1) {
      const before = unsent.substring(0, jsonIdx);
      if (before) this._send('llm-token', before);
      this._sent = this._buffer.length;
      this._holdingToolCall = true;
      this._holdingFenced = true;
      this._toolCallJson = unsent.substring(jsonIdx + 7);
      console.log(`[StreamHandler] Tool hold ENTERED (fenced) — ${before.length} chars sent before hold, ${this._buffer.length} total buffered`);
      this._emitToolProgress();
      return;
    }

    // Check for raw JSON tool call patterns (no fences)
    const rawIdx = this._detectRawJsonToolCall(unsent);
    if (rawIdx !== -1) {
      const before = unsent.substring(0, rawIdx);
      if (before) this._send('llm-token', before);
      this._sent = this._buffer.length;
      this._holdingToolCall = true;
      this._holdingFenced = false;
      this._toolCallJson = unsent.substring(rawIdx);
      console.log(`[StreamHandler] Tool hold ENTERED (raw JSON) — ${before.length} chars sent before hold, ${this._buffer.length} total buffered`);
      this._emitToolProgress();
      return;
    }

    // Check if unsent ends with a partial marker (prefix of "```json")
    if (this._endsWithPartialMarker(unsent)) {
      return;
    }

    // Check if unsent ends with a partial raw JSON marker
    if (this._endsWithPartialJsonMarker(unsent)) {
      return;
    }

    // No tool call pattern — safe to send
    // R35-L2: If _fileContentActive but no tool hold, the model is generating
    // tokens in iter 2 after stream.reset() cleared _holdingToolCall.
    // Buffer these tokens instead of flushing as llm-token (which causes naked code).
    // The suspense buffer is resolved by agenticLoop after generation completes.
    if (this._fileContentActive && !this._holdingToolCall && !this._holdingFenced) {
      const unsent2 = this._buffer.slice(this._sent);
      if (unsent2) {
        if (!this._suspenseMode) {
          console.log(`[StreamHandler] R35-L2: Suspense mode ACTIVATED — _fileContentActive="${this._fileContentFilePath}" but no tool hold`);
          this._suspenseMode = true;
        }
        this._suspenseBuffer += unsent2;
        this._sent = this._buffer.length;
      }
      return;
    }
    this._flush();
  }

  /**
   * Check if `text` ends with any prefix of "```json".
   */
  _endsWithPartialMarker(text) {
    const marker = '```json';
    for (let len = 1; len < marker.length; len++) {
      if (text.endsWith(marker.substring(0, len))) return true;
    }
    return false;
  }

  /**
   * Detect a raw JSON tool call pattern in text (no fences).
   * Returns the index where the JSON object starts, or -1 if none found.
   */
  _detectRawJsonToolCall(text) {
    // Only match if the JSON appears to be a tool call, not regular JSON in prose
    const patterns = [
      /\{"tool_calls"\s*:\s*\[/,
      /\{"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:/,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) return m.index;
    }
    return -1;
  }

  /**
   * Check if text ends with a partial raw JSON tool call marker.
   * Holds buffer when we see opening chars that could become {"tool or {"tool_calls
   */
  _endsWithPartialJsonMarker(text) {
    // Check if text ends with any prefix of '{"tool' (min 2 chars to avoid false positives)
    const marker = '{"tool';
    for (let len = 2; len < marker.length; len++) {
      if (text.endsWith(marker.substring(0, len))) return true;
    }
    // Also check: the entire unsent text IS a prefix of or starts with the marker.
    // This catches the case where a token like '{"tool' arrives as one piece —
    // the text IS the marker, it doesn't END WITH a shorter prefix of it.
    const trimmed = text.trimStart();
    if (trimmed.length > 0 && trimmed.length <= marker.length && marker.startsWith(trimmed)) return true;
    if (trimmed.startsWith(marker)) return true;
    return false;
  }

  /** Send all unsent text to the UI. */
  _flush() {
    const unsent = this._buffer.slice(this._sent);
    if (unsent) {
      this._send('llm-token', unsent);
      this._sent = this._buffer.length;
    }
  }

  /**
   * D03/D07: Check if accumulated JSON content looks like a tool call.
   * Used for look-ahead validation on fenced ```json blocks.
   */
  _looksLikeToolCall() {
    return /"tool"\s*:/.test(this._toolCallJson) ||
           /"tool_calls"\s*:/.test(this._toolCallJson);
  }

  /**
   * Stream file content from a write tool call to the UI in real-time.
   * During tool hold, the model generates JSON like:
   *   {"tool":"write_file","params":{"filePath":"app.html","content":"<!DOCTYPE html>..."}}
   * Instead of hiding the content, extract the "content" field and send it as
   * llm-token events so the user sees code being written immediately.
   *
   * For continuation iterations (where the model continues raw content without
   * JSON wrapper), all tokens are sent directly.
   *
   * Returns true if content streaming is active (caller should not emit tool progress).
   */
  _streamFileContent(text) {
    const WRITE_TOOLS = ['write_file', 'create_file', 'append_to_file'];
    const json = this._toolCallJson;

    // T40-Fix: Removed _contentContinuation blind-send block.
    // Previously, this sent ALL tokens (prose, JSON wrappers, everything) directly
    // to the UI when _contentContinuation was true. Now, ALL iterations go through
    // the structured extraction logic below, which only streams the "content"
    // field value from write_file tool calls.

    // Check if this is a write tool (match both "tool" and "name" keys —
    // Qwen3.5 and similar models use {"name":"write_file"} inside tool_calls wrapper)
    const toolMatch = json.match(/"(?:tool|name)"\s*:\s*"([^"]+)"/);

    // T36-DIAG: log what the regex is matching (or failing to match) — first 300 chars only, once per 2000 chars
    if (!this._lastDiagLen || json.length - this._lastDiagLen > 2000) {
      this._lastDiagLen = json.length;
      console.log(`[T36-DIAG] _streamFileContent: jsonLen=${json.length}, toolMatch=${toolMatch ? toolMatch[1] : 'null'}, first300=${JSON.stringify(json.substring(0, 300))}`);
    }

    if (!toolMatch || !WRITE_TOOLS.includes(toolMatch[1])) return false;

    // Check if "content":" or "content":' has appeared in the accumulated JSON
    // Qwen3.5 and some models use single quotes for string values
    // Also check for escaped version for stringified arguments
    const contentMatch = json.match(/"content"\s*:\s*"/) || json.match(/\\?"content\\?"\s*:\s*\\?['"]/);
    if (!contentMatch) return false;

    const contentStart = contentMatch.index + contentMatch[0].length;
    let raw = json.substring(contentStart);

    // Don't process trailing incomplete escape sequences
    if (raw.endsWith('\\') && (raw.length < 2 || raw.charAt(raw.length - 2) !== '\\')) {
      if (!this._contentStreamStarted) return false; // wait for next char
      return true; // content streaming active, but skip this token
    }

    // Unescape JSON string characters
    const unescaped = raw
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\\\/g, '\\');

    if (!this._contentStreamStarted) {
      // First time content detected in this iteration — transition to streaming mode

      // Clear the frontend's generatingToolCalls by sending done:true so that
      // hasTools becomes false and streamingText renders directly (no duplication)
      const nameMatch = json.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: nameMatch ? nameMatch[1] : 'write_file',
        paramsText: '',
        done: true,
      });

      // R19: Determine file path and decide whether to start a new block or resume
      const fpMatch = matchFilePathInText(json);
      const fp = fpMatch ? fpMatch[1] : '';

      if (this._fileContentActive && fp && fp === this._fileContentFilePath) {
        // Same file across iterations — resume into existing block (no new event)
        this._contentStreamStarted = true;
        this._contentStreamSent = 0;
        console.log(`[StreamHandler] File content RESUMED for "${fp}"`);
      } else {
        if (this._fileContentActive) {
          // Different file — end the previous block
          this._send('file-content-end', { filePath: this._fileContentFilePath });
        }

        // Determine language from file extension
        const ext = fp.includes('.') ? fp.split('.').pop().toLowerCase() : '';
        let fenceLabel = ext || 'text';

        // R15-Fix-C: When file extension is unknown, sniff content type
        if (fenceLabel === 'text') {
          const contentMatch = matchContentStartInText(json);  // R22-Fix: also match single quote
          if (contentMatch) {
            const snippet = json.substring(contentMatch.index + contentMatch[0].length, contentMatch.index + contentMatch[0].length + 120);
            const unSnippet = snippet.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\//g, '/').replace(/\\\\/g, '\\').trimStart();
            if (/^<!DOCTYPE\s+html/i.test(unSnippet) || /^<html[\s>]/i.test(unSnippet)) fenceLabel = 'html';
            else if (/^(?::root|html|body|\*|@charset|@import|@font-face|@media|@keyframes|\.[\w-]|#[\w-])/.test(unSnippet)) fenceLabel = 'css';
            else if (/^import\s|^from\s|^def\s|^class\s/.test(unSnippet)) fenceLabel = 'python';
            else if (/^(?:import|export|const|let|var|function|class)\s/.test(unSnippet)) fenceLabel = 'javascript';
            else if (/^(?:#include|#pragma|int\s+main)/.test(unSnippet)) fenceLabel = 'c';
            else if (/^\{[\s\n]*"/.test(unSnippet)) fenceLabel = 'json';
            else if (/^---\n|^title:/.test(unSnippet)) fenceLabel = 'yaml';
          }
        }

        // R35-L5: Normalize the label using file extension as ground truth
        fenceLabel = StreamHandler.normalizeLanguageLabel(fenceLabel, fp);

        const fname = fp.includes('/') ? fp.split('/').pop() : fp.includes('\\') ? fp.split('\\').pop() : fp;

        // Send prose header as llm-token (appears in chat text)
        if (fp) {
          this._send('llm-token', `\nWriting **${fname}**...\n`);
        }

        // Start new file content block via separate event channel
        this._send('file-content-start', { filePath: fp, language: fenceLabel, fileName: fname || fp });
        this._fileContentActive = true;
        this._fileContentFilePath = fp;
        this._contentStreamStarted = true;
        this._contentStreamSent = 0;
        console.log(`[StreamHandler] File content STARTED for "${fp || 'unknown'}"`);
      }
    }

    // Send only the newly generated content (delta since last send)
    // T58-Fix-C: Hold back last 3 chars to avoid streaming JSON closing
    // syntax ("}} ) to UI. During streaming, the model emits these chars
    // one at a time. When the tool call is properly closed, raw includes
    // the " (closing content string) + }} (closing JSON objects).
    // The holdback is flushed in finalize() with the JSON pattern stripped.
    const newContent = unescaped.substring(this._contentStreamSent);
    if (newContent) {
      const HOLDBACK = 3;
      const combined = (this._contentHoldback || '') + newContent;
      if (combined.length > HOLDBACK) {
        const safe = combined.substring(0, combined.length - HOLDBACK);
        this._contentHoldback = combined.substring(combined.length - HOLDBACK);
        this._send('file-content-token', safe);
        // R26-D7: Track cumulative content length for debugging line-count drops
        this._cumulativeContentLen = (this._cumulativeContentLen || 0) + safe.length;
      } else {
        this._contentHoldback = combined;
      }
      this._contentStreamSent = unescaped.length;
    }

    return true;
  }

  /** Emit tool-generating progress from accumulated JSON. */
  _emitToolProgress() {
    // Match both "name": and "tool": patterns (different model output styles)
    const nameMatch = this._toolCallJson.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: nameMatch[1],
        paramsText: this._toolCallJson,
        done: false,
      });
    } else if (this._toolCallJson.length > 10) {
      // Emit progress even before tool name is found (model is generating)
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: '...',
        paramsText: this._toolCallJson,
        done: false,
      });
    } else if (this._toolCallJson.length === 0 && this._continuationMeta) {
      // Fix C: Between continuations, _toolCallJson is empty but we preserved
      // the filePath/tool from the previous iteration. Emit a progress event
      // with the meta so the frontend can maintain the code block.
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: this._continuationMeta.tool || '...',
        paramsText: `{"tool":"${this._continuationMeta.tool}","params":{"filePath":"${this._continuationMeta.filePath}"}}`,
        done: false,
      });
    }
  }

  /**
   * Called when generation finishes.
   * If not holding a tool call, flushes remaining buffer.
   * D03/D07: If holding content that turned out NOT to be a tool call
   * (false positive — e.g. a ```json code example), flush it to the UI.
   */
  finalize(isToolCall) {
    // R19: If file content was active but model stopped without a tool call, end the block
    // R37-Step3: Only end the file content block if this is the FINAL finalize (no more iterations).
    // Between iterations, _fileContentActive must survive so the next iteration can resume
    // into the same block. The agenticLoop calls endFileContent() explicitly when the loop exits.
    // R37-Fix: Also guard on _suspenseMode — when suspense is active, there's pending content
    // that hasn't been resolved yet. finalize() must NOT kill _fileContentActive before
    // resolveSuspense() runs, or the suspended content routes as llm-token (naked text leak).
    if (!isToolCall && this._fileContentActive && !this._contentResuming && !this._suspenseMode && !this._keepFileContentAlive) {
      this._send('file-content-end', { filePath: this._fileContentFilePath });
      this._fileContentActive = false;
      this._fileContentFilePath = null;
    }

    // D03/D07: False positive recovery — release held content as regular text
    if (this._holdingToolCall && !isToolCall) {
      // R28-1a: If content was already streamed to the UI via file-content-token
      // events, do NOT dump the raw tool JSON as llm-token text. The user already
      // sees the code in a file content block. Dumping 26K chars of raw JSON on
      // top causes D1 (3 code blocks), D2 (raw JSON visible), D7 (empty text block).
      // The agenticLoop salvage path still has full rawText to extract tool calls from.
      if (this._contentStreamStarted) {
        console.log(`[StreamHandler] R28-1a: Tool hold RELEASED (false positive) but content was ALREADY STREAMED (${this._toolCallJson.length} chars) — suppressing raw JSON dump to UI`);
        // Clear frontend generatingToolCalls indicator
        const nameMatch = this._toolCallJson.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
        this._send('llm-tool-generating', {
          callIndex: 0,
          functionName: nameMatch ? nameMatch[1] : '...',
          paramsText: '',
          done: true,
        });
        // Do NOT send llm-token — content is already displayed via file-content-token
        // Do NOT send file-content-end — the R19 block above already handled it
        this._holdingToolCall = false;
        this._holdingFenced = false;
        this._toolCallJson = '';
        this._contentStreamStarted = false;
        this._contentStreamSent = 0;
        this._contentContinuation = false;
        this._contentResuming = false;
        this._contentHoldback = '';
        this._sent = this._buffer.length;
      } else {
        // Original false-positive path: content was NOT streamed, so dump as text
        const prefix = this._holdingFenced ? '```json' : '';
        console.log(`[StreamHandler] Tool hold RELEASED (false positive) — ${this._toolCallJson.length} chars released as text`);
        // Clear frontend generatingToolCalls BEFORE releasing text — prevents
        // hasTools staying true and suppressing streaming text rendering
        const nameMatch = this._toolCallJson.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
        this._send('llm-tool-generating', {
          callIndex: 0,
          functionName: nameMatch ? nameMatch[1] : '...',
          paramsText: '',
          done: true,
        });
        this._send('llm-token', prefix + this._toolCallJson);
        this._holdingToolCall = false;
        this._holdingFenced = false;
        this._toolCallJson = '';
        this._contentStreamStarted = false;
        this._contentStreamSent = 0;
        this._contentContinuation = false;
        this._contentResuming = false;
        this._contentHoldback = '';
        this._sent = this._buffer.length;
      }
    }

    if (!this._holdingToolCall && !isToolCall) {
      this._flush();
    }
    // Mark tool call generation as done (only for real tool calls still being held)
    if (this._holdingToolCall) {
      this._contentStreamedFlag = this._contentStreamStarted || this._contentContinuation || this._contentResuming;
      console.log(`[StreamHandler] Tool hold FINALIZED (real tool call) — ${this._toolCallJson.length} chars in tool JSON, contentStreamed=${this._contentStreamedFlag}`);

      // Close the code fence if we were streaming file content to the UI
      if (this._contentStreamedFlag) {
        // T58-Fix-C: Flush holdback buffer, stripping JSON closing syntax.
        if (this._contentHoldback) {
          let held = this._contentHoldback;
          held = held.replace(/"\s*}\s*}?\s*$/, '');
          if (held) this._send('file-content-token', held);
          this._contentHoldback = '';
        }
        // R19: Do NOT send file-content-end here — more iterations may follow
        // for the same file. endFileContent() is called when the loop is truly done.
      }

      const nameMatch = this._toolCallJson.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        this._send('llm-tool-generating', {
          callIndex: 0,
          functionName: nameMatch[1],
          paramsText: this._toolCallJson,
          done: true,
        });
      }
    }
  }

  /** Check if content was streamed to UI during the last finalize cycle. */
  wasContentStreamed() {
    return this._contentStreamedFlag || false;
  }

  /** Reset buffer state for the next generation cycle. */
  reset() {
    if (this._holdingToolCall && this._toolCallJson.length > 0) {
      console.log(`[StreamHandler] reset() — clearing ${this._toolCallJson.length} chars of held tool JSON (was ${this._holdingFenced ? 'fenced' : 'raw'})`);
    }
    this._buffer = '';
    this._sent = 0;
    this._holdingToolCall = false;
    this._holdingFenced = false;
    this._toolCallJson = '';
    this._continuationMeta = null;
    this._contentStreamStarted = false;
    this._contentStreamedFlag = false;
    this._contentStreamSent = 0;
    this._contentContinuation = false;
    this._contentResuming = false;
    this._contentHoldback = '';
    // R19: _fileContentActive and _fileContentFilePath survive reset —
    // they track whether a file content block is open across iterations
    // R35-L2: suspense buffer and mode survive reset — cleared by resolveSuspense()
    // or explicitly by agenticLoop when the suspense is handled
  }

  /**
   * Partial reset for continuation iterations where a tool call is in progress.
   * Preserves the tool-hold state (_holdingToolCall, _holdingFenced) so that
   * new tokens from the continuation stream directly into the same
   * tool-generating event — keeping the UI code block alive.
   * Preserves _continuationMeta (filePath+tool) so the frontend can maintain
   * the code block even when _toolCallJson is empty between continuations.
   * Only resets the buffer position counters for the new generation cycle.
   *
   * If content was being streamed to the UI, sets _contentContinuation so the
   * next iteration sends raw tokens directly (model continues without JSON wrapper).
   */
  continueToolHold() {
    // Extract filePath and tool name before clearing _toolCallJson
    if (this._toolCallJson.length > 0) {
      const fpMatch = matchFilePathInText(this._toolCallJson);
      const toolMatch = this._toolCallJson.match(/"tool"\s*:\s*"([^"]+)"/);
      if (fpMatch || toolMatch) {
        this._continuationMeta = {
          filePath: fpMatch ? fpMatch[1] : (this._continuationMeta?.filePath || ''),
          tool: toolMatch ? toolMatch[1] : (this._continuationMeta?.tool || ''),
        };
      }
    }
    // T40/T43-Fix: Do NOT set _contentContinuation = true. That sent ALL tokens
    // (including prose and raw JSON) blindly to the UI, causing tool call JSON
    // to appear inside the code block and lines to freeze.
    // Instead, set _contentResuming = true so that when _streamFileContent()
    // detects the next write_file content field, it skips the code fence opener
    // (because the fence is already open from the previous iteration) and streams
    // only the extracted content value into the SAME code block.
    if (this._contentStreamStarted) {
      this._contentResuming = true;
      console.log('[StreamHandler] Content resuming mode — will stream extracted content into existing code block');
    }
    this._buffer = '';
    this._sent = 0;
    this._toolCallJson = '';
    this._contentStreamStarted = false;
    this._contentStreamSent = 0;
    this._contentContinuation = false;
    // _holdingToolCall preserved (keeps token accumulation active)
    // _holdingFenced cleared — new iteration may output raw JSON, not fenced
    this._holdingFenced = false;
  }

  /**
   * R19: End the active file content block. Called by agenticLoop when
   * the file write is complete or the generation loop exits.
   */
  endFileContent() {
    if (this._fileContentActive) {
      // R26-D7: Log cumulative content sent for debugging line-count drops
      if (this._cumulativeContentLen) {
        console.log(`[StreamHandler] File content ENDED for "${this._fileContentFilePath}" (${this._cumulativeContentLen} chars sent to frontend)`);
      }
      this._send('file-content-end', { filePath: this._fileContentFilePath });
      this._fileContentActive = false;
      this._fileContentFilePath = null;
      this._cumulativeContentLen = 0;
    }
  }

  /**
   * R35-L2: Check if there is suspended content from the suspense buffer.
   */
  hasSuspendedContent() {
    return this._suspenseBuffer.length > 0;
  }

  /**
   * R35-L2: Get the raw suspended content without resolving it.
   */
  getSuspendedContent() {
    return this._suspenseBuffer;
  }

  /**
   * R35-L2: Resolve the suspense buffer by routing content to the appropriate channel.
   * @param {boolean} isFileContent — if true, send as file-content-token (extends existing block).
   *                                   if false, send as llm-token (goes to text segment).
   */
  resolveSuspense(isFileContent) {
    if (!this._suspenseBuffer) {
      this._suspenseMode = false;
      return;
    }
    if (isFileContent && this._fileContentActive) {
      console.log(`[StreamHandler] R35-L2: Suspense resolved as FILE CONTENT (${this._suspenseBuffer.length} chars) — extending "${this._fileContentFilePath}"`);
      this._send('file-content-token', this._suspenseBuffer);
      this._cumulativeContentLen = (this._cumulativeContentLen || 0) + this._suspenseBuffer.length;
      // R37-Fix: _fileContentActive stays alive — more iterations may follow
    } else {
      console.log(`[StreamHandler] R35-L2: Suspense resolved as TEXT (${this._suspenseBuffer.length} chars)`);
      this._send('llm-token', this._suspenseBuffer);
      // R42-Fix-1: Do NOT kill _fileContentActive here. The agenticLoop decides
      // whether the file is structurally complete. Killing it prematurely causes
      // subsequent tokens to flush as llm-token (naked code in chat).
      // The agenticLoop calls endFileContent() when the file is truly done.
    }
    this._suspenseBuffer = '';
    this._suspenseMode = false;
  }

  getFullText()    { return this._buffer; }
  isHoldingTool()  { return this._holdingToolCall; }
  isHoldingFenced() { return this._holdingFenced; }

  /**
   * R35-L5: Normalize a language label based on file extension.
   * Maps nonsensical labels (e.g., "php-template" on an HTML file) to the
   * correct language. Uses file extension as ground truth when available.
   *
   * @param {string} label — The language label to normalize
   * @param {string} filePath — The file path (for extension detection)
   * @returns {string} — The normalized language label
   */
  static normalizeLanguageLabel(label, filePath) {
    if (!filePath) return label || 'text';

    const ext = filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : '';
    if (!ext) return label || 'text';

    // Map of file extensions to canonical language names
    const EXT_TO_LANG = {
      html: 'html', htm: 'html',
      css: 'css', scss: 'scss', sass: 'sass', less: 'less',
      js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      py: 'python',
      rb: 'ruby',
      java: 'java',
      c: 'c', h: 'c',
      cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
      cs: 'csharp',
      go: 'go',
      rs: 'rust',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin', kts: 'kotlin',
      r: 'r',
      sql: 'sql',
      sh: 'bash', bash: 'bash', zsh: 'bash',
      ps1: 'powershell', psm1: 'powershell',
      json: 'json', jsonc: 'json',
      xml: 'xml', xhtml: 'xml', xaml: 'xml',
      yaml: 'yaml', yml: 'yaml',
      md: 'markdown',
      svg: 'svg',
      toml: 'toml',
      ini: 'ini', cfg: 'ini',
      dockerfile: 'dockerfile',
      vue: 'vue', svelte: 'svelte',
    };

    const canonical = EXT_TO_LANG[ext];
    if (canonical) {
      // If the label doesn't match the extension, override it
      if (label && label.toLowerCase() !== canonical) {
        console.log(`[StreamHandler] R35-L5: Normalized language label "${label}" -> "${canonical}" (ext="${ext}")`);
      }
      return canonical;
    }

    // Extension not in map — trust the label or fallback to extension
    return label || ext || 'text';
  }

  /**
   * Atomic tool checkpoint — sends finalize + executing + results as ONE IPC event.
   * Prevents the race condition where generatingToolCalls is cleared before
   * completedStreamingTools is populated, causing code blocks to disappear
   * for 1-2 React render frames during context rotation.
   */
  toolCheckpoint(toolDataArray) {
    // R19: End file content block if active
    if (this._fileContentActive) {
      this._send('file-content-end', { filePath: this._fileContentFilePath });
      this._fileContentActive = false;
      this._fileContentFilePath = null;
    }
    // Finalize any held tool call state without sending the separate done:true event
    this._holdingToolCall = false;
    this._holdingFenced = false;
    this._toolCallJson = '';
    this._contentStreamStarted = false;
    this._contentStreamSent = 0;
    this._contentContinuation = false;
    this._contentResuming = false;

    // Send a single atomic event the frontend can process in one state update
    this._send('tool-checkpoint', toolDataArray);
  }

  /**
   * Notify frontend of updated accumulated file content without disrupting tool-hold state.
   * Called after every direct executeTool() checkpoint in D6/continuation paths so that
   * fileContentAccRef stays current and code blocks show the full growing file, not just
   * the tiny current-iteration stream.
   */
  fileAccUpdate(filePath, fullContent) {
    this._send('llm-file-acc-update', { filePath, fullContent });
  }

  /* ── Other UI events ────────────────────────────────────── */
  thinkingToken(t)           { this._send('llm-thinking-token', t); }
  iterationBegin()           { this._send('llm-iteration-begin'); }
  replaceLast(text)          { this._send('llm-replace-last', text); }
  progress(i, max)           { this._send('agentic-progress', { iteration: i, maxIterations: max }); }
  phase(p, s, label)         { this._send('agentic-phase', { phase: p, status: s, label }); }
  toolExecuting(tools)       { this._send('tool-executing', tools); }
  toolResults(results)       { this._send('mcp-tool-results', results); }
  contextUsage(used, total)  { this._send('context-usage', { used, total }); }
  tokenStats(stats)          { this._send('token-stats', stats); }
  todoUpdate(todos)          { this._send('todo-update', todos); }
}

module.exports = { StreamHandler };
