/**
 * Markdown → TeX layout, rendered by MathJax like equations (vector output, offline, canvas-safe).
 *
 * Supported subset:
 *   blocks:  # / ## / ### headings, "- " "* " "+ " bullets (2 spaces per nesting level), "1. " numbered
 *            items, "> " quotes, blank lines (paragraph gap). Every other line break is kept as typed —
 *            lines never wrap automatically (MathJax 3 has no line breaking).
 *   inline:  **bold** / __bold__, *italic* / _italic_, ***bold italic***, `code`, $math$ and \(math\).
 * Anything else is shown literally.
 */

export class MarkdownError extends Error {
  override name = "MarkdownError";
}

/** Escapes literal text for MathJax's \text{} (textmacros). */
export function escapeTextMode(s: string): string {
  let out = "";
  for (const ch of s) {
    switch (ch) {
      case "\\":
        out += "$\\backslash$";
        break;
      case "{":
      case "}":
      case "$":
      case "_":
      case "#":
      case "%":
      case "&":
        out += `\\${ch}`;
        break;
      case "~":
        out += '{\\char"7E}';
        break;
      case "^":
        out += '{\\char"5E}';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Inline Markdown → content for \text{…}. Math segments are passed through as $…$. */
export function inlineToTex(src: string): string {
  let out = "";
  let plain = "";
  const flush = () => {
    out += escapeTextMode(plain);
    plain = "";
  };
  /** Index of the next unescaped `token` at or after `from`, or -1. */
  const findClose = (token: string, from: number): number => {
    for (let j = from; j <= src.length - token.length; j++) {
      if (src[j] === "\\") {
        j++;
        continue;
      }
      if (src.startsWith(token, j)) return j;
    }
    return -1;
  };
  const EMPHASIS: ReadonlyArray<readonly [string, string, string]> = [
    ["***", "\\textbf{\\textit{", "}}"],
    ["**", "\\textbf{", "}"],
    ["__", "\\textbf{", "}"],
    ["*", "\\textit{", "}"],
    ["_", "\\textit{", "}"],
  ];

  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    const next = src.charAt(i + 1);

    // \( … \) inline math.
    if (ch === "\\" && next === "(") {
      const close = src.indexOf("\\)", i + 2);
      if (close > i + 2) {
        flush();
        out += `$${src.slice(i + 2, close)}$`;
        i = close + 2;
        continue;
      }
    }
    // Backslash escapes: \* \_ \` \$ \\ \# → the literal character.
    if (ch === "\\" && next !== "" && "*_`$\\#[]()".includes(next)) {
      plain += next;
      i += 2;
      continue;
    }
    // $ … $ inline math.
    if (ch === "$") {
      const close = findClose("$", i + 1);
      if (close > i + 1) {
        flush();
        out += `$${src.slice(i + 1, close)}$`;
        i = close + 1;
        continue;
      }
    }
    // `code`
    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i + 1) {
        flush();
        out += `\\texttt{${escapeTextMode(src.slice(i + 1, close))}}`;
        i = close + 1;
        continue;
      }
    }
    // Emphasis: the opening token must not be followed by a space, the closing one not preceded by one.
    let consumed = false;
    const isWord = (c: string) => /[\p{L}\p{N}]/u.test(c);
    for (const [token, open, closeTex] of EMPHASIS) {
      if (!src.startsWith(token, i) || src.charAt(i + token.length) === " ") continue;
      // Underscores inside a word (snake_case_name) are never emphasis.
      if (token.startsWith("_") && isWord(src.charAt(i - 1))) continue;
      const close = findClose(token, i + token.length);
      if (token.startsWith("_") && close >= 0 && isWord(src.charAt(close + token.length))) continue;
      if (close > i + token.length && src.charAt(close - 1) !== " ") {
        flush();
        out += open + inlineToTex(src.slice(i + token.length, close)) + closeTex;
        i = close + token.length;
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

const HEADING_SIZE = ["", "\\Large", "\\large", "\\normalsize"] as const;

/** Full Markdown note → one TeX expression (a left-aligned array, one row per output line). */
export function markdownToTex(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[0]?.trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length === 0) throw new MarkdownError("Type some text");

  const rows: string[] = [];
  let gapBefore = false;
  for (const raw of lines) {
    if (raw.trim() === "") {
      gapBefore = rows.length > 0;
      continue;
    }
    const indentSpaces = raw.match(/^ */)?.[0].length ?? 0;
    const line = raw.trim();
    const quads = "\\quad ".repeat(Math.floor(indentSpaces / 2));
    let row: string;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const level = m[1]?.length ?? 1;
      row = `{${HEADING_SIZE[level]}\\text{\\textbf{${inlineToTex(m[2] ?? "")}}}}`;
    } else if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      row = `${quads}\\bullet\\ \\text{${inlineToTex(m[1] ?? "")}}`;
    } else if ((m = line.match(/^(\d{1,3})[.)]\s+(.*)$/))) {
      row = `${quads}\\text{${m[1]}. ${inlineToTex(m[2] ?? "")}}`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      row = `${quads}\\Big|\\ \\text{\\textit{${inlineToTex(m[1] ?? "")}}}`;
    } else {
      row = `${quads}\\text{${inlineToTex(line)}}`;
    }
    rows.push((gapBefore ? "[0.6em]" : "") + row);
    gapBefore = false;
  }
  // "\\[gap]" is attached to the previous row's terminator.
  let tex = "";
  rows.forEach((row, idx) => {
    if (idx === 0) {
      tex += row.replace(/^\[0\.6em\]/, "");
    } else if (row.startsWith("[0.6em]")) {
      tex += `\\\\[0.6em] ${row.slice("[0.6em]".length)}`;
    } else {
      tex += `\\\\ ${row}`;
    }
  });
  return `\\begin{array}{l} ${tex} \\end{array}`;
}
