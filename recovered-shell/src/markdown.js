function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function inline(value = "") {
  const raw = String(value);
  // Protect code, escaped punctuation and generated attributes from subsequent
  // emphasis replacements. Choose a delimiter that cannot occur in user text.
  let marker = "\uE000";
  while (raw.includes(marker)) marker += "\uE000";
  const tokens = [];
  const protectedText = raw.replace(/(`+)([\s\S]*?)\1|(!?)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\\([\\`*_[\]{}()#+.!>~-])/g,
    (match, ticks, code, image, label, url, escaped) => {
      const html = ticks ? `<code>${escapeHtml(code)}</code>`
        : escaped ? escapeHtml(escaped)
        : image ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" referrerpolicy="no-referrer">`
        : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inline(label)}</a>`;
      tokens.push(html);
      return `${marker}${tokens.length - 1}${marker}`;
    });
  return escapeHtml(protectedText)
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>")
    .replace(new RegExp(`${marker}(\\d+)${marker}`, "g"), (_, index) => tokens[Number(index)]);
}

export function renderMarkdown(markdown = "") {
  const lines = String(markdown).replace(/\r/g, "").split("\n");
  let html = "";
  let paragraph = [];
  let list = null;
  let inCode = false;
  let code = [];

  const closeParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${inline(paragraph.join(" "))}</p>`;
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += `</${list}>`;
    list = null;
  };
  const openList = type => {
    if (list === type) return;
    closeList();
    list = type;
    html += `<${type}>`;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      closeParagraph();
      closeList();
      if (inCode) {
        html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
        code = [];
        inCode = false;
      } else inCode = true;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const next = lines[index + 1] || "";
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(next)) {
      closeParagraph();
      closeList();
      const heads = line.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(lines[index].replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()));
        index += 1;
      }
      index -= 1;
      html += `<table><thead><tr>${heads.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      closeParagraph(); closeList(); html += "<hr>"; continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      closeParagraph(); closeList();
      const level = heading[1].length;
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }
    const quote = line.match(/^>\s?(.*)/);
    if (quote) {
      closeParagraph(); closeList(); html += `<blockquote>${inline(quote[1])}</blockquote>`; continue;
    }
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)/);
    if (task) {
      closeParagraph(); openList("ul");
      html += `<li class="task-item"><input type="checkbox" disabled ${task[1].toLowerCase() === "x" ? "checked" : ""}>${inline(task[2])}</li>`;
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)/);
    if (bullet) {
      closeParagraph(); openList("ul"); html += `<li>${inline(bullet[1])}</li>`; continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (ordered) {
      closeParagraph(); openList("ol"); html += `<li>${inline(ordered[1])}</li>`; continue;
    }
    if (!line.trim()) {
      closeParagraph(); closeList(); continue;
    }
    paragraph.push(line.trim());
  }
  closeParagraph();
  closeList();
  if (inCode) html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
  return html || "<p><br></p>";
}

export function htmlToMarkdown(root, { preserveFormatting = false } = {}) {
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      return preserveFormatting ? text.replace(/([\\`*_\[\]])/g, "\\$1").replace(/^(#{1,6}|>) /gm, "\\$1 ") : text;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    const content = [...node.childNodes].map(walk).join("");
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === "p" || tag === "div") return `${content.trim()}\n\n`;
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `*${content}*`;
    if (tag === "del" || tag === "s") return `~~${content}~~`;
    if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") {
      const literal = node.textContent || "";
      const longest = Math.max(0, ...(literal.match(/`+/g) || []).map(ticks => ticks.length));
      const fence = "`".repeat(longest + 1);
      return `${fence}${literal}${fence}`;
    }
    if (tag === "pre") return `\`\`\`\n${node.textContent || ""}\n\`\`\`\n\n`;
    if (tag === "blockquote") return `${(preserveFormatting ? content.trim() : node.textContent || "").split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
    if (tag === "a") return `[${content}](${node.getAttribute("href") || ""})`;
    if (tag === "img") return `![${node.getAttribute("alt") || ""}](${node.getAttribute("src") || ""})`;
    if (tag === "hr") return "---\n\n";
    if (tag === "li") {
      const parent = node.parentElement?.tagName.toLowerCase();
      const checkbox = node.querySelector(":scope > input[type=checkbox]");
      if (checkbox) return `- [${checkbox.checked ? "x" : " "}] ${content.replace(/^\s+/, "")}\n`;
      return `${parent === "ol" ? "1." : "-"} ${content.trim()}\n`;
    }
    if (tag === "ul" || tag === "ol") return `${content}\n`;
    if (tag === "table") {
      const rows = [...node.querySelectorAll(":scope > thead > tr, :scope > tbody > tr")].map(row => [...row.children].map(cell => preserveFormatting ? [...cell.childNodes].map(walk).join("").trim() : cell.textContent.trim()));
      if (!rows.length) return "";
      return `| ${rows[0].join(" | ")} |\n| ${rows[0].map(() => "---").join(" | ")} |\n${rows.slice(1).map(row => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
    }
    return content;
  };
  return [...root.childNodes].map(walk).join("").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
