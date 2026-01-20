#!/usr/bin/env node
/**
 * Pretty-print a single JSONL log line (like `logs/example-agent.log`) into a user-friendly string.
 *
 * Usage:
 *   node scripts/pretty-log-line.js '<one json line>'
 *   echo '<one json line>' | node scripts/pretty-log-line.js
 *
 * Contract:
 * - Always prints something.
 * - If JSON parsing fails, prints the raw input line.
 * - Always ends output with a double newline.
 */

const readline = require("node:readline");

function safeJsonParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false, value: null };
  }
}

function asSingleLine(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickTextFromContent(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    else if (typeof item.text === "string") parts.push(item.text);
  }
  return asSingleLine(parts.join("\n"));
}

function pickRawTextFromContent(content) {
  // Preserve leading/trailing spaces across fragments so streamed partials concatenate naturally.
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const t = typeof item.text === "string" ? item.text : "";
    if (!t) continue;
    out += t;
  }
  // Keep it single-line for terminal friendliness, but do NOT trim/collapse spaces.
  return String(out).replace(/\r\n/g, "\n").replace(/\n/g, " ");
}

function fmtTime(obj) {
  const ts = obj?.timestamp_ms;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function fmtPrefix(obj) {
  const type = obj?.type;
  const subtype = obj?.subtype;
  const t = fmtTime(obj);
  const pieces = [];
  if (t) pieces.push(t);
  if (typeof type === "string") pieces.push(type);
  if (typeof subtype === "string") pieces.push(subtype);
  return pieces.length ? `[${pieces.join(" / ")}] ` : "";
}

function fmtHeader(obj) {
  // Header used for streaming grouping/deduping. Intentionally excludes timestamps so it stays stable.
  const type = obj?.type;
  const subtype = obj?.subtype;
  const pieces = [];
  if (typeof type === "string") pieces.push(type);
  if (typeof subtype === "string") pieces.push(subtype);
  return pieces.length ? `[${pieces.join(" / ")}]` : "";
}

function summarizeToolCall(obj) {
  const toolCall = obj?.tool_call;
  if (!toolCall || typeof toolCall !== "object") return "Tool call";

  // Tool call container usually looks like: { lsToolCall: { args: {...}, result: {...} } }
  const toolNames = Object.keys(toolCall);
  const toolName = toolNames[0] || "tool";
  const inner = toolCall[toolName];
  const args = inner?.args;

  if (toolName === "shellToolCall") {
    const cmd = args?.command ?? args?.simpleCommand ?? args?.simpleCommands?.[0];
    if (cmd) return `Shell: ${asSingleLine(cmd)}`;
    return "Shell: (command)";
  }

  if (toolName === "lsToolCall") {
    const p = args?.path;
    if (p) return `List dir: ${asSingleLine(p)}`;
    return "List dir";
  }

  if (toolName === "readToolCall") {
    const p = args?.file_path ?? args?.path;
    if (p) return `Read file: ${asSingleLine(p)}`;
    return "Read file";
  }

  if (toolName === "writeToolCall") return "Write file";
  if (toolName === "applyPatchToolCall") return "Apply patch";

  // Fallback: show tool name + a hint of args
  const hint =
    args && typeof args === "object"
      ? asSingleLine(
          Object.entries(args)
            .slice(0, 3)
            .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(" ")
        )
      : "";
  return hint ? `${toolName}: ${hint}` : toolName;
}

function summarize(obj) {
  const prefix = fmtPrefix(obj);

  // system init
  if (obj?.type === "system" && obj?.subtype === "init") {
    const model = obj?.model;
    const cwd = obj?.cwd;
    const session = obj?.session_id;
    const bits = [];
    if (model) bits.push(`model=${model}`);
    if (cwd) bits.push(`cwd=${cwd}`);
    if (session) bits.push(`session=${session}`);
    return `${prefix}System init${bits.length ? ` (${bits.join(", ")})` : ""}`;
  }

  // thinking delta
  if (obj?.type === "thinking") {
    const text = asSingleLine(obj?.text);
    return `${prefix}${text || "(thinking)"}`;
  }

  // user + assistant messages
  if ((obj?.type === "user" || obj?.type === "assistant") && obj?.message) {
    const role = obj?.message?.role ?? obj?.type;
    const text = pickTextFromContent(obj?.message?.content);
    return `${prefix}${role}: ${text || "(no text)"}`;
  }

  // tool_call
  if (obj?.type === "tool_call") {
    const status = obj?.subtype === "completed" ? "completed" : obj?.subtype === "started" ? "started" : "";
    const summary = summarizeToolCall(obj);
    return `${prefix}${status ? `Tool ${status}: ` : "Tool: "}${summary}`;
  }

  // result
  if (obj?.type === "result") {
    const ok = obj?.subtype;
    const dur = obj?.duration_ms;
    const msg = asSingleLine(obj?.result);
    const bits = [];
    if (typeof ok === "string") bits.push(ok);
    if (typeof dur === "number" && Number.isFinite(dur)) bits.push(`${dur}ms`);
    return `${prefix}Result${bits.length ? ` (${bits.join(", ")})` : ""}: ${msg || "(empty)"}`;
  }

  // fallback
  if (obj && typeof obj === "object") {
    const compact = asSingleLine(JSON.stringify(obj));
    return `${prefix}${compact || "(empty object)"}`;
  }

  return `${prefix}${asSingleLine(String(obj))}`;
}

function bodyFor(obj) {
  // Like summarize(), but without any leading prefix/header. Intended for the "content line".
  // system init
  if (obj?.type === "system" && obj?.subtype === "init") {
    const model = obj?.model;
    const cwd = obj?.cwd;
    const session = obj?.session_id;
    const bits = [];
    if (model) bits.push(`model=${model}`);
    if (cwd) bits.push(`cwd=${cwd}`);
    if (session) bits.push(`session=${session}`);
    return `System init${bits.length ? ` (${bits.join(", ")})` : ""}`;
  }

  // thinking delta
  if (obj?.type === "thinking") {
    return asSingleLine(obj?.text) || "(thinking)";
  }

  // user + assistant messages
  if ((obj?.type === "user" || obj?.type === "assistant") && obj?.message) {
    return pickTextFromContent(obj?.message?.content) || "(no text)";
  }

  // tool_call
  if (obj?.type === "tool_call") {
    return summarizeToolCall(obj);
  }

  // result
  if (obj?.type === "result") {
    const ok = obj?.subtype;
    const dur = obj?.duration_ms;
    const msg = asSingleLine(obj?.result);
    const bits = [];
    if (typeof ok === "string") bits.push(ok);
    if (typeof dur === "number" && Number.isFinite(dur)) bits.push(`${dur}ms`);
    return `Result${bits.length ? ` (${bits.join(", ")})` : ""}: ${msg || "(empty)"}`;
  }

  // fallback
  if (obj && typeof obj === "object") return asSingleLine(JSON.stringify(obj)) || "(empty object)";
  return asSingleLine(String(obj));
}

async function main() {
  const argvLine = process.argv.slice(2).join(" ");
  const rawArg = argvLine.trimEnd();

  // If a line is passed as an argument, process it immediately.
  if (rawArg) {
    const parsed = safeJsonParse(rawArg);
    if (!parsed.ok) {
      process.stdout.write(rawArg + "\n\n");
      return;
    }
    const header = fmtHeader(parsed.value);
    const body = bodyFor(parsed.value);
    if (header) process.stdout.write(header + "\n");
    process.stdout.write(body + "\n\n");
    return;
  }

  // Otherwise, stream stdin line-by-line and print as we go.
  if (process.stdin.isTTY) {
    process.stdout.write("\n\n");
    return;
  }

  process.stdin.setEncoding("utf8");
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  let wroteAny = false;
  let openRun = null; // { kind: "assistant" | "user" | "thinking", lastCh: string }
  let lastHeader = "";

  function flushRun() {
    if (!openRun) return;
    process.stdout.write("\n\n");
    openRun = null;
  }

  function maybePrintHeader(header) {
    const h = String(header ?? "");
    if (!h) return;
    if (h === lastHeader) return;
    process.stdout.write(h + "\n");
    lastHeader = h;
  }

  function startOrAppendRun(kind, header, fragment) {
    const frag = String(fragment ?? "");
    if (!frag) return;

    if (!openRun || openRun.kind !== kind) {
      flushRun();
      maybePrintHeader(header);
      openRun = { kind, lastCh: "" };
    }

    process.stdout.write(frag);
    openRun.lastCh = frag[frag.length - 1] || openRun.lastCh;
  }

  rl.on("line", (line) => {
    const trimmed = String(line ?? "").trimEnd();
    if (!trimmed) return;

    const parsed = safeJsonParse(trimmed);
    if (!parsed.ok) {
      flushRun();
      process.stdout.write(trimmed + "\n\n");
      wroteAny = true;
      return;
    }

    const obj = parsed.value;
    const header = fmtHeader(obj);

    // Merge consecutive assistant/user message fragments into a single continuous line.
    if ((obj?.type === "assistant" || obj?.type === "user") && obj?.message) {
      const role = obj?.message?.role ?? obj?.type;
      const text = pickRawTextFromContent(obj?.message?.content);
      startOrAppendRun(role, `[${role}]`, text);
      wroteAny = true;
      return;
    }

    // Merge thinking deltas similarly.
    if (obj?.type === "thinking") {
      const t = String(obj?.text ?? "").replace(/\r\n/g, "\n").replace(/\n/g, " ");
      startOrAppendRun("thinking", "[thinking]", t);
      wroteAny = true;
      return;
    }

    // Non-mergeable event: flush current run, then print a normal summarized entry.
    flushRun();
    maybePrintHeader(header);
    process.stdout.write(bodyFor(obj) + "\n\n");
    wroteAny = true;
  });

  await new Promise((resolve) => rl.on("close", resolve));
  if (!wroteAny) {
    process.stdout.write("\n\n");
    return;
  }
  flushRun();
}

main().catch((err) => {
  // On unexpected errors, fall back to raw input if possible.
  const raw = process.argv.slice(2).join(" ");
  if (raw) process.stdout.write(raw.trimEnd() + "\n\n");
  else process.stdout.write(asSingleLine(String(err?.message ?? err)) + "\n\n");
  process.exitCode = 0;
});

