const STANDALONE_POST_ID = /^\s*#([1-9]\d{0,9})\s*$/;
const INLINE_POST_ID = /#([1-9]\d{0,9})\b/g;
const MARKDOWN_IMAGE = /!\[([^\]\n]*)\]\((https:\/\/[^)\s]+)\)/gi;
const FENCE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/;
const HORIZONTAL_RULE = /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const LIST_ITEM = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
const TABLE_DIVIDER_CELL = /^:?-{3,}:?$/;

function normalizeBody(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parsePostContent(value) {
  const quotePids = [];
  const seenPids = new Set();
  const bodyLines = [];

  for (const line of String(value ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(STANDALONE_POST_ID);
    if (match) {
      const pid = Number(match[1]);
      if (!seenPids.has(pid)) {
        quotePids.push(pid);
        seenPids.add(pid);
      }
      continue;
    }
    for (const inlineMatch of line.matchAll(INLINE_POST_ID)) {
      const pid = Number(inlineMatch[1]);
      if (!seenPids.has(pid)) {
        quotePids.push(pid);
        seenPids.add(pid);
      }
    }
    bodyLines.push(line);
  }

  const body = normalizeBody(bodyLines.join("\n"));
  const segments = [];
  const images = [];
  let cursor = 0;

  for (const match of body.matchAll(MARKDOWN_IMAGE)) {
    if (match.index > cursor) {
      segments.push({ type: "text", text: body.slice(cursor, match.index) });
    }
    const image = { type: "image", alt: match[1].trim(), url: match[2] };
    segments.push(image);
    images.push(image);
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length) {
    segments.push({ type: "text", text: body.slice(cursor) });
  }

  return { body, segments, images, quotePids };
}

export function contentSummary(value, maxLength = 180) {
  const parsed = parsePostContent(value);
  const text = markdownPlainText(parsed.segments
    .filter(segment => segment.type === "text")
    .map(segment => segment.text)
    .join(" "))
    .replace(/\s+/g, " ")
    .trim();
  const fallback = parsed.images.length ? "（图片）" : "（内容为空）";
  const summary = text || fallback;
  return summary.length > maxLength ? `${summary.slice(0, maxLength).trimEnd()}…` : summary;
}

export function isSafeImageUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isSafeLinkUrl(value) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkHtml(label, url) {
  if (!isSafeLinkUrl(url)) return `${escapeHtml(label)}（${escapeHtml(url)}）`;
  const labelHtml = label === url ? escapeHtml(label) : renderInline(label);
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${labelHtml}</a>`;
}

function findClosingMarker(source, marker, start) {
  const end = source.indexOf(marker, start + marker.length);
  return end > start + marker.length ? end : -1;
}

function trimBareUrl(value) {
  let url = value;
  while (/[.,;:!?，。；：！？\])}]$/.test(url)) {
    if (url.endsWith(")") && (url.match(/\(/g)?.length || 0) >= (url.match(/\)/g)?.length || 0)) break;
    url = url.slice(0, -1);
  }
  return url;
}

function renderInline(source) {
  let html = "";
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);

    if (source[index] === "\\" && index + 1 < source.length && /[\\`*_[\]{}()#+\-.!~>]/.test(source[index + 1])) {
      html += escapeHtml(source[index + 1]);
      index += 2;
      continue;
    }

    const codeRun = rest.match(/^(`+)/);
    if (codeRun) {
      const marker = codeRun[1];
      const end = source.indexOf(marker, index + marker.length);
      if (end >= 0) {
        html += `<code>${escapeHtml(source.slice(index + marker.length, end).trim())}</code>`;
        index = end + marker.length;
        continue;
      }
    }

    if (rest.startsWith("[")) {
      const middle = source.indexOf("](", index + 1);
      const end = middle >= 0 ? source.indexOf(")", middle + 2) : -1;
      if (middle > index + 1 && end > middle + 2) {
        const label = source.slice(index + 1, middle);
        const url = source.slice(middle + 2, end).trim();
        html += linkHtml(label, url);
        index = end + 1;
        continue;
      }
    }

    const angleUrl = rest.match(/^<(https?:\/\/[^>\s]+)>/i);
    if (angleUrl) {
      html += linkHtml(angleUrl[1], angleUrl[1]);
      index += angleUrl[0].length;
      continue;
    }

    const bareUrl = rest.match(/^https?:\/\/[^\s<]+/i);
    if (bareUrl) {
      const url = trimBareUrl(bareUrl[0]);
      html += linkHtml(url, url);
      index += url.length;
      continue;
    }

    const strongMarker = rest.startsWith("**") ? "**" : rest.startsWith("__") ? "__" : null;
    if (strongMarker) {
      const end = findClosingMarker(source, strongMarker, index);
      if (end >= 0) {
        html += `<strong>${renderInline(source.slice(index + 2, end))}</strong>`;
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("~~")) {
      const end = findClosingMarker(source, "~~", index);
      if (end >= 0) {
        html += `<del>${renderInline(source.slice(index + 2, end))}</del>`;
        index = end + 2;
        continue;
      }
    }

    if (source[index] === "*" || source[index] === "_") {
      const marker = source[index];
      const previous = source[index - 1] || "";
      const next = source[index + 1] || "";
      const canOpen = next && !/\s/.test(next) && !(marker === "_" && /[\p{L}\p{N}]/u.test(previous));
      const end = canOpen ? findClosingMarker(source, marker, index) : -1;
      if (end >= 0 && !/\s/.test(source[end - 1])) {
        html += `<em>${renderInline(source.slice(index + 1, end))}</em>`;
        index = end + 1;
        continue;
      }
    }

    if (source[index] === "\n") {
      html += "<br>";
      index++;
      continue;
    }

    html += escapeHtml(source[index]);
    index++;
  }
  return html;
}

function tableCells(line) {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return value.split("|").map(cell => cell.trim());
}

function isTableDivider(line) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => TABLE_DIVIDER_CELL.test(cell));
}

function tableAlignment(cell) {
  if (cell.startsWith(":") && cell.endsWith(":")) return "center";
  if (cell.endsWith(":")) return "right";
  if (cell.startsWith(":")) return "left";
  return "";
}

function isBlockStart(lines, index) {
  const line = lines[index] || "";
  return !line.trim()
    || FENCE.test(line)
    || HEADING.test(line)
    || HORIZONTAL_RULE.test(line)
    || /^ {0,3}>/.test(line)
    || LIST_ITEM.test(line)
    || /^ {4}\S/.test(line)
    || (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1]));
}

export function markdownToHtml(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const language = fence[2].trim().split(/\s+/)[0].replace(/[^\w+-]/g, "");
      const code = [];
      index++;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[index])) {
        code.push(lines[index++]);
      }
      if (index < lines.length) index++;
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
      blocks.push(`<pre><code${languageClass}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = Math.min(6, heading[1].length + 2);
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    if (HORIZONTAL_RULE.test(line)) {
      blocks.push("<hr>");
      index++;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted = [];
      while (index < lines.length && (/^ {0,3}>/.test(lines[index]) || !lines[index].trim())) {
        quoted.push(lines[index].replace(/^ {0,3}>\s?/, ""));
        index++;
      }
      blocks.push(`<blockquote>${markdownToHtml(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    const listMatch = line.match(LIST_ITEM);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[2]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(LIST_ITEM);
        if (!match || /^\d/.test(match[2]) !== ordered) break;
        const itemLines = [match[3]];
        const baseIndent = match[1].length;
        index++;
        while (index < lines.length && lines[index].trim() && !LIST_ITEM.test(lines[index])) {
          const continuationIndent = (lines[index].match(/^\s*/) || [""])[0].length;
          if (continuationIndent <= baseIndent) break;
          itemLines.push(lines[index].trim());
          index++;
        }
        items.push(`<li>${renderInline(itemLines.join("\n"))}</li>`);
      }
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    if (/^ {4}\S/.test(line)) {
      const code = [];
      while (index < lines.length && (/^ {4}/.test(lines[index]) || !lines[index].trim())) {
        code.push(lines[index].replace(/^ {4}/, ""));
        index++;
      }
      blocks.push(`<pre><code>${escapeHtml(code.join("\n").replace(/\n+$/, ""))}</code></pre>`);
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const dividers = tableCells(lines[index + 1]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index++]));
      }
      const head = headers.map((cell, cellIndex) => {
        const align = tableAlignment(dividers[cellIndex] || "");
        return `<th${align ? ` class="align-${align}"` : ""}>${renderInline(cell)}</th>`;
      }).join("");
      const body = rows.map(cells => `<tr>${headers.map((_, cellIndex) => {
        const align = tableAlignment(dividers[cellIndex] || "");
        return `<td${align ? ` class="align-${align}"` : ""}>${renderInline(cells[cellIndex] || "")}</td>`;
      }).join("")}</tr>`).join("");
      blocks.push(`<div class="markdown-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    const paragraph = [line];
    index++;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index++]);
    }
    blocks.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }

  return blocks.join("");
}

export function markdownPlainText(value) {
  return String(value ?? "")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, "$1")
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^ {0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[^\p{L}\p{N}])[*_]([^*_\n]+)[*_](?=$|[^\p{L}\p{N}])/gu, "$1$2")
    .replace(/^ {0,3}(?:[-*_]\s*){3,}$/gm, "")
    .replace(/\|/g, " ");
}
