// Minimal, dependency-free XLSX + CSV writer for the Emortia Workspace.
// Builds a real .xlsx (OOXML, STORE-method zip) entirely in the browser.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = (s) => new TextEncoder().encode(s);

// Build a ZIP archive (no compression / STORE) from [{name, data:Uint8Array}]
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 0xFF, (n >> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const f of files) {
    const nameBytes = enc(f.name);
    const data = f.data;
    const crc = crc32(data);
    const local = [].concat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0)
    );
    const localHead = new Uint8Array(local);
    chunks.push(localHead, nameBytes, data);
    const localLen = localHead.length + nameBytes.length + data.length;

    central.push({ nameBytes, crc, size: data.length, offset });
    offset += localLen;
  }

  const cdStart = offset;
  const cdChunks = [];
  for (const c of central) {
    const rec = [].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(c.crc), u32(c.size), u32(c.size),
      u16(c.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(c.offset)
    );
    const head = new Uint8Array(rec);
    cdChunks.push(head, c.nameBytes);
    offset += head.length + c.nameBytes.length;
  }
  const cdLen = offset - cdStart;
  const eocd = new Uint8Array([].concat(
    u32(0x06054b50), u16(0), u16(0),
    u16(central.length), u16(central.length),
    u32(cdLen), u32(cdStart), u16(0)
  ));

  const all = [...chunks, ...cdChunks, eocd];
  const total = all.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function safeSheetName(name, used) {
  let n = String(name || 'Sheet').replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let base = n, i = 2;
  while (used.has(n.toLowerCase())) { n = (base.slice(0, 28) + ' ' + i).slice(0, 31); i++; }
  used.add(n.toLowerCase());
  return n;
}

function sheetXml(rows) {
  let body = '';
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    let cells = '';
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === '' || v == null) continue;
      const ref = colLetter(c) + (r + 1);
      const num = typeof v === 'number' || (/^-?\d+(\.\d+)?$/.test(String(v)) && String(v).trim() !== '');
      if (num) cells += `<c r="${ref}"><v>${xmlEsc(v)}</v></c>`;
      else cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }
    body += `<row r="${r + 1}">${cells}</row>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function buildXlsx(sheets) {
  const used = new Set();
  const named = sheets.map((s) => ({ name: safeSheetName(s.name, used), rows: s.rows || [] }));

  const files = [];
  files.push({
    name: '[Content_Types].xml',
    data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  });
  files.push({
    name: '_rels/.rels',
    data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  });
  files.push({
    name: 'xl/workbook.xml',
    data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`)
  });
  named.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.rows)) });
  });

  const bytes = zipStore(files);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function toCsv(rows) {
  return rows.map((row) => (row || []).map((v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
