export interface ParsedToken {
  value: string;
  raw: string;
  quote: "none" | "single" | "double";
  hasExpansion: boolean;
  hasGlob: boolean;
}

export interface ParsedSegment {
  raw: string;
  tokens: ParsedToken[];
  verb: string;
  verbLower: string;
  args: ParsedToken[];
  hasRedirection: boolean;
  hasSubshell: boolean;
  hasLineBreak: boolean;
}

export interface ParsedCommandLine {
  raw: string;
  segments: ParsedSegment[];
  isCompound: boolean;
  hasAnyRedirection: boolean;
  hasAnySubshell: boolean;
  hasAnyExpansion: boolean;
  hasAnyGlob: boolean;
}

const COMPOUND_OPS = new Set(["&&", "||", ";", "|", "&", "\n"]);
const REDIRECT_OPS = new Set([">", ">>", "<", "<<", "2>", "2>>", "&>", "1>", "1>>"]);

interface RawLexItem {
  kind: "word" | "op";
  value: string;
  raw: string;
  quote: "none" | "single" | "double";
  hasExpansion: boolean;
  hasGlob: boolean;
  hasSubshell: boolean;
}

function lexCommandLine(input: string): RawLexItem[] {
  const items: RawLexItem[] = [];
  let i = 0;
  const len = input.length;

  const pushWord = (
    value: string,
    raw: string,
    quote: "none" | "single" | "double",
    hasExpansion: boolean,
    hasGlob: boolean,
    hasSubshell: boolean
  ) => {
    items.push({ kind: "word", value, raw, quote, hasExpansion, hasGlob, hasSubshell });
  };

  while (i < len) {
    const ch = input[i];

    if (ch === "\r") {
      i += 1;
      continue;
    }

    if (ch === "\n") {
      items.push({
        kind: "op",
        value: "\n",
        raw: "\n",
        quote: "none",
        hasExpansion: false,
        hasGlob: false,
        hasSubshell: false,
      });
      i += 1;
      continue;
    }

    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }

    // Two-char operators
    const two = input.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === ">>" || two === "<<" || two === "2>" || two === "&>" || two === "1>") {
      if ((two === "2>" || two === "1>") && input[i + 2] === ">") {
        const three = input.slice(i, i + 3);
        items.push({ kind: "op", value: three, raw: three, quote: "none", hasExpansion: false, hasGlob: false, hasSubshell: false });
        i += 3;
        continue;
      }
      items.push({ kind: "op", value: two, raw: two, quote: "none", hasExpansion: false, hasGlob: false, hasSubshell: false });
      i += 2;
      continue;
    }

    // Single-char operators
    if (ch === ";" || ch === "|" || ch === "&" || ch === ">" || ch === "<") {
      items.push({ kind: "op", value: ch, raw: ch, quote: "none", hasExpansion: false, hasGlob: false, hasSubshell: false });
      i += 1;
      continue;
    }

    // Read a word (may contain mixed single/double quoted segments)
    let value = "";
    const startIdx = i;
    let firstQuote: "none" | "single" | "double" = "none";
    let hasExpansion = false;
    let hasGlob = false;
    let hasSubshell = false;

    while (i < len) {
      const c = input[i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === ";" || c === "|" || c === "&" || c === ">" || c === "<") {
        break;
      }

      if (c === "'") {
        if (firstQuote === "none") firstQuote = "single";
        i += 1;
        while (i < len && input[i] !== "'") {
          // Windows CMD does not treat single quote as escaping %VAR%
          if (input[i] === "%") {
            const nextPct = input.indexOf("%", i + 1);
            if (nextPct > i + 1 && !/\s/.test(input.slice(i + 1, nextPct))) {
              hasExpansion = true;
            }
          }
          value += input[i];
          i += 1;
        }
        if (i < len && input[i] === "'") {
          i += 1;
        }
        continue;
      }

      if (c === '"') {
        if (firstQuote === "none") firstQuote = "double";
        i += 1;
        while (i < len && input[i] !== '"') {
          const dc = input[i];
          if (dc === "\\" && i + 1 < len && (input[i + 1] === '"' || input[i + 1] === "\\" || input[i + 1] === "$")) {
            value += input[i + 1];
            i += 2;
            continue;
          }
          if (dc === "`" && i + 1 < len) {
            // PowerShell escape or POSIX backtick subshell
            if (input[i + 1] === '"' || input[i + 1] === "`" || input[i + 1] === "$") {
              value += input[i + 1];
              i += 2;
              continue;
            }
            hasSubshell = true;
          }
          if (dc === "$") {
            if (input[i + 1] === "(") {
              hasSubshell = true;
            }
            if (i + 1 < len && /[A-Za-z0-9_{(*?@#!]/.test(input[i + 1])) {
              hasExpansion = true;
            }
          }
          if (dc === "%") {
            const nextPct = input.indexOf("%", i + 1);
            if (nextPct > i + 1 && !/\s/.test(input.slice(i + 1, nextPct))) {
              hasExpansion = true;
            }
          }
          value += dc;
          i += 1;
        }
        if (i < len && input[i] === '"') {
          i += 1;
        }
        continue;
      }

      // Unquoted character
      if (c === "\\" && i + 1 < len) {
        const next = input[i + 1];
        // Preserve Windows backslash path separators like foo\bar unless escaping space/quote/dollar
        if (next === " " || next === '"' || next === "'" || next === "$" || next === "`" || next === "&" || next === "|") {
          value += next;
          i += 2;
          continue;
        }
      }

      if (c === "(" || c === ")") {
        hasSubshell = true;
      }
      if (c === "`") {
        hasSubshell = true;
      }
      if (c === "$") {
        if (input[i + 1] === "(") {
          hasSubshell = true;
        }
        if (i + 1 < len && /[A-Za-z0-9_{(*?@#!]/.test(input[i + 1])) {
          hasExpansion = true;
        }
      }
      if (c === "%") {
        const nextPct = input.indexOf("%", i + 1);
        if (nextPct > i + 1 && !/\s/.test(input.slice(i + 1, nextPct))) {
          hasExpansion = true;
        }
      }
      if (c === "*" || c === "?" || c === "[") {
        hasGlob = true;
      }

      value += c;
      i += 1;
    }

    pushWord(value, input.slice(startIdx, i), firstQuote, hasExpansion, hasGlob, hasSubshell);
  }

  return items;
}

export function normalizeVerb(rawVerb: string): string {
  if (!rawVerb) {
    return "";
  }
  const forward = rawVerb.replace(/\\/g, "/");
  const idx = forward.lastIndexOf("/");
  const base = idx >= 0 ? forward.slice(idx + 1) : forward;
  return base.replace(/\.exe$/i, "");
}

function buildSegment(rawItems: RawLexItem[], hasLineBreak: boolean): ParsedSegment {
  const tokens: ParsedToken[] = [];
  let hasRedirection = false;
  let hasSubshell = false;

  for (const item of rawItems) {
    if (item.kind === "op") {
      if (REDIRECT_OPS.has(item.value)) {
        hasRedirection = true;
      }
      continue;
    }
    if (item.hasSubshell) {
      hasSubshell = true;
    }
    tokens.push({
      value: item.value,
      raw: item.raw,
      quote: item.quote,
      hasExpansion: item.hasExpansion,
      hasGlob: item.hasGlob,
    });
  }

  const verb = tokens.length > 0 ? normalizeVerb(tokens[0].value) : "";
  return {
    raw: rawItems.map((it) => it.raw).join(" "),
    tokens,
    verb,
    verbLower: verb.toLowerCase(),
    args: tokens.slice(1),
    hasRedirection,
    hasSubshell,
    hasLineBreak,
  };
}

export function parseCommandLine(input: string): ParsedCommandLine {
  const items = lexCommandLine(input);
  const segments: ParsedSegment[] = [];
  let current: RawLexItem[] = [];
  let isCompound = false;
  let hasLineBreak = false;

  for (const item of items) {
    if (item.kind === "op" && COMPOUND_OPS.has(item.value)) {
      if (item.value === "\n") {
        hasLineBreak = true;
      }
      if (current.length > 0) {
        segments.push(buildSegment(current, hasLineBreak));
        current = [];
      }
      isCompound = true;
      continue;
    }
    current.push(item);
  }
  if (current.length > 0) {
    segments.push(buildSegment(current, hasLineBreak));
  }

  if (segments.length > 1) {
    isCompound = true;
  }

  return {
    raw: input,
    segments,
    isCompound,
    hasAnyRedirection: segments.some((s) => s.hasRedirection),
    hasAnySubshell: segments.some((s) => s.hasSubshell),
    hasAnyExpansion: segments.some((s) => s.tokens.some((t) => t.hasExpansion)),
    hasAnyGlob: segments.some((s) => s.tokens.some((t) => t.hasGlob)),
  };
}
