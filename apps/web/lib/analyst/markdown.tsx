import React from 'react';

/**
 * Minimal markdown renderer for analyst output.
 *
 * Why hand-rolled rather than react-markdown:
 *   1. The analyst emits a narrow, known subset — headings, bold, italic,
 *      inline code, fenced code, lists, blockquotes, links. A full CommonMark
 *      implementation plus remark-gfm is ~60kB gzipped for that.
 *   2. The CI inline-style/bundle ratchets only fall. A new runtime dependency
 *      on the hottest client component is a decision, not a detail.
 *
 * Why it returns React nodes and never HTML:
 *   Analyst answers quote tool results verbatim — vessel names, GDELT
 *   headlines, OFAC entity names. That is untrusted third-party text arriving
 *   through our own feeds. `dangerouslySetInnerHTML` on it would be an
 *   injection vector. Every branch below emits React elements, so React
 *   escapes the text for us and there is no path from feed content to markup.
 *
 * Deliberately NOT supported: underscore emphasis (_foo_). Analyst output is
 * full of snake_case tool names — query_agent_reports, went_dark_lights,
 * ais_chokepoint_weekly — and treating underscores as emphasis mangles every
 * one of them. Asterisk emphasis only.
 *
 * Streaming-safe: an unterminated `**` or an unclosed fence simply fails to
 * match and renders as literal text, so a half-arrived token never throws.
 */

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

/** Only http(s) links survive. Anything else renders as plain text. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-i${i++}`;

    if (m[1]) {
      out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
    } else if (m[2]) {
      out.push(<strong key={key}>{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{m[3].slice(1, -1)}</em>);
    } else if (m[4]) {
      const split = m[4].indexOf('](');
      const label = m[4].slice(1, split);
      const href = safeHref(m[4].slice(split + 2, -1));
      out.push(
        href
          ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
          : <span key={key}>{m[4]}</span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Paragraph text keeps its single newlines as <br/>. */
function renderParagraph(lines: string[], key: string): React.ReactNode {
  const kids: React.ReactNode[] = [];
  lines.forEach((line, n) => {
    if (n > 0) kids.push(<br key={`${key}-br${n}`} />);
    kids.push(...renderInline(line, `${key}-l${n}`));
  });
  return <p key={key}>{kids}</p>;
}

export function renderMarkdown(source: string): React.ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let b = 0;

  const flushParagraph = () => {
    if (para.length) {
      blocks.push(renderParagraph(para, `p${b++}`));
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code — consume to the closing fence, or to the end while streaming
    if (/^\s*```/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      blocks.push(<pre key={`c${b++}`}><code>{body.join('\n')}</code></pre>);
      continue;
    }

    if (!line.trim()) { flushParagraph(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const depth = Math.min(heading[1].length, 3);
      const Tag = (`h${depth}` as 'h1' | 'h2' | 'h3');
      const key = `h${b++}`;
      blocks.push(<Tag key={key}>{renderInline(heading[2], key)}</Tag>);
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph();
      blocks.push(<hr key={`r${b++}`} />);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      i--;
      const key = `q${b++}`;
      blocks.push(<blockquote key={key}>{renderParagraph(quoted, key)}</blockquote>);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      const items: string[] = [];
      while (i < lines.length) {
        const hit = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
          : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (!hit) break;
        items.push(hit[1]);
        i++;
      }
      i--;
      const key = `${ordered ? 'o' : 'u'}${b++}`;
      const li = items.map((t, n) => <li key={`${key}-${n}`}>{renderInline(t, `${key}-${n}`)}</li>);
      blocks.push(ordered ? <ol key={key}>{li}</ol> : <ul key={key}>{li}</ul>);
      continue;
    }

    para.push(line);
  }

  flushParagraph();
  return blocks;
}

/** Drop-in for `{message.content}` in a `.chat-content` container. */
export function Markdown({ text }: { text: string }): JSX.Element {
  return <>{renderMarkdown(text)}</>;
}
