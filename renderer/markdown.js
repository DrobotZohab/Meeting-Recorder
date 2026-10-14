// Tiny, safe Markdown renderer for summaries (headings, lists, to-dos, bold, italics, code).
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

  function render(md) {
    const out = [];
    let list = null; // 'ul' | 'ol' | 'todo'
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const closeList = () => { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } };
    const openList = (kind) => {
      if (list === kind) return;
      closeList();
      out.push(kind === 'ol' ? '<ol>' : kind === 'todo' ? '<ul class="todos">' : '<ul>');
      list = kind;
    };

    for (const raw of String(md || '').split(/\r?\n/)) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushPara(); closeList(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushPara(); closeList();
        const lvl = Math.min(4, m[1].length + 1);
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      } else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        flushPara(); openList('todo');
        const done = m[1].toLowerCase() === 'x';
        out.push(`<li class="todo${done ? ' done' : ''}"><span class="box" role="checkbox" aria-checked="${done}"></span><span>${inline(m[2])}</span></li>`);
      } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        flushPara(); openList('ul');
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara(); openList('ol');
        out.push(`<li>${inline(m[1])}</li>`);
      } else if (/^-{3,}$/.test(line.trim())) {
        flushPara(); closeList(); out.push('<hr>');
      } else {
        closeList(); para.push(line.trim());
      }
    }
    flushPara(); closeList();
    return out.join('\n');
  }

  window.renderMarkdown = render;
})();
