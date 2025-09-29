import { SankeyDiagram } from '../lib/Sankey';
import type { SankeyData, SankeyNode, SankeyLink } from '../lib/types';
import { dbSaveLayout, dbListLayouts, dbGetLayout, dbDeleteLayout } from '../lib/db';

// Стартовые данные (если пользователь не загрузил CSV)
const defaultData: SankeyData = {
  nodes: [
    { id: 'A', label: 'Источники A', color: '#22c55e' },
    { id: 'B', label: 'Источники B', color: '#06b6d4' },
    { id: 'C', label: 'Обработка C', color: '#f59e0b' },
    { id: 'D', label: 'Обработка D', color: '#ef4444' },
    { id: 'E', label: 'Хранилище E', color: '#8b5cf6' },
    { id: 'F', label: 'Потребители F', color: '#6366f1' }
  ],
  links: [
    { source: 'A', target: 'C', value: 10 },
    { source: 'B', target: 'C', value: 6 },
    { source: 'A', target: 'D', value: 4, color: '#16a34a' },
    { source: 'C', target: 'E', value: 12 },
    { source: 'D', target: 'E', value: 4 },
    { source: 'E', target: 'F', value: 14 }
  ]
};

const app = document.getElementById('app')!;
const sankey = new SankeyDiagram(app, defaultData, {
  width: app.clientWidth,
  height: app.clientHeight,
  linkWidthScale: 2,
  draggable: true,
  saveKey: 'sankey-ts-demo' // используется только для локального снапшота/экспорта
});

// ===== UI refs =====
const scale = document.getElementById('scale') as HTMLInputElement;
const scaleVal = document.getElementById('scaleVal')!;
const layoutName = document.getElementById('layoutName') as HTMLInputElement;
const layoutSelect = document.getElementById('layoutSelect') as HTMLSelectElement;
const saveAsBtn = document.getElementById('saveAsBtn') as HTMLButtonElement;
const loadSelectedBtn = document.getElementById('loadSelectedBtn') as HTMLButtonElement;
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn') as HTMLButtonElement;

const linksFile = document.getElementById('linksFile') as HTMLInputElement;
const nodesFile = document.getElementById('nodesFile') as HTMLInputElement;
const buildBtn = document.getElementById('buildBtn') as HTMLButtonElement;

const zoomInBtn = document.getElementById('zoomInBtn') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoomOutBtn') as HTMLButtonElement;
const fitBtn = document.getElementById('fitBtn') as HTMLButtonElement;

const helpBtn = document.getElementById('helpBtn') as HTMLButtonElement;
const helpModal = document.getElementById('helpModal') as HTMLDialogElement;
const helpCloseBtn = document.getElementById('helpCloseBtn') as HTMLButtonElement;

const toasts = document.getElementById('toasts')!;

// ===== Толщина потоков =====
scale.addEventListener('input', () => {
  sankey.setLinkWidthScale(parseFloat(scale.value));
  scaleVal.textContent = `${parseFloat(scale.value).toFixed(1)}x`;
});

// ===== Сохранения в IndexedDB =====
saveAsBtn.onclick = async () => {
  const name = (layoutName.value || '').trim();
  if (!name) {
    toast('Введите имя варианта перед сохранением');
    layoutName.focus();
    return;
  }
  // Получаем полный снимок (узлы+связи+опции), но не пишем в localStorage
  const snapshot = (sankey as any).saveLayout?.(false) ?? JSON.parse(sankey.exportLayoutJSON());
  await dbSaveLayout(name, snapshot);
  await populateLayoutOptionsAsync(name);
  toast(`Сохранено в БД: «${name}»`);
};

loadSelectedBtn.onclick = async () => {
  const name = layoutSelect.value;
  if (!name) {
    toast('Выберите вариант для загрузки');
    return;
  }
  const snap = await dbGetLayout(name);
  if (!snap) {
    toast('Вариант не найден в БД');
    return;
  }
  (sankey as any).loadLayout?.(snap); // Полная загрузка проекта из снапшота (без CSV)
  scale.dispatchEvent(new Event('input'));
  toast(`Загружено из БД: «${name}»`);
};

deleteSelectedBtn.onclick = async () => {
  const name = layoutSelect.value;
  if (!name) {
    toast('Выберите вариант для удаления');
    return;
  }
  if (confirm(`Удалить сохранение "${name}" из БД?`)) {
    await dbDeleteLayout(name);
    await populateLayoutOptionsAsync('');
    toast(`Удалено: «${name}»`);
  }
};

// ===== Сброс и экспорт =====
(document.getElementById('resetBtn') as HTMLButtonElement).onclick = () => {
  location.reload();
};
(document.getElementById('exportBtn') as HTMLButtonElement).onclick = () => {
  const json = sankey.exportLayoutJSON();
  (document.getElementById('exportBox') as HTMLTextAreaElement).value = json;
  toast('Экспортировано в JSON (см. панель справа)');
};

// ===== Загрузка CSV -> построение диаграммы =====
buildBtn.onclick = async () => {
  const linksText = await readFileText(linksFile.files?.[0]).catch(() => null);
  if (!linksText) {
    toast('Пожалуйста, выберите файл links.csv');
    return;
  }
  const nodesText = await readFileText(nodesFile.files?.[0]).catch(() => null);

  try {
    const links = parseLinksCSV(linksText);
    const nodes = nodesText ? parseNodesCSV(nodesText) : inferNodesFromLinks(links);
    const data: SankeyData = { nodes, links };
    sankey.setData(data);
    scale.dispatchEvent(new Event('input'));
    toast('Диаграмма построена из CSV');
  } catch (e: any) {
    toast(`Ошибка: ${e?.message || e}`);
  }
};

// ===== Инициализировать список сохранений (IndexedDB) =====
async function populateLayoutOptionsAsync(selectName?: string) {
  const names = await dbListLayouts();
  layoutSelect.innerHTML = '<option value="">— сохранённые варианты —</option>';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    if (selectName && n === selectName) opt.selected = true;
    layoutSelect.appendChild(opt);
  }
}
populateLayoutOptionsAsync();

// ===== Зум/Фит =====
zoomInBtn.onclick = (e) => { sankey.zoomIn(1.2, { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY }); };
zoomOutBtn.onclick = (e) => { sankey.zoomOut(1/1.2, { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY }); };
fitBtn.onclick = () => { sankey.fit(); };

// ===== Справка (модал) =====
helpBtn.onclick = () => helpModal.showModal();
helpCloseBtn.onclick = () => helpModal.close();

// ===== Тосты =====
function toast(msg: string, timeout = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

// ===== Ресайз контейнера =====
window.addEventListener('resize', () => {
  sankey.resize(app.clientWidth, app.clientHeight);
  // @ts-ignore — приватный метод из демо
  (sankey as any).compute?.();
  sankey.render();
});

// ===== Горячие клавиши =====
window.addEventListener('keydown', (e) => {
  if (e.key === '?') { helpModal.open ? helpModal.close() : helpModal.showModal(); }
  if (e.key === '+' || (e.key === '=' && e.shiftKey)) { sankey.zoomIn(1.2); }
  if (e.key === '-' || e.key === '_') { sankey.zoomOut(1/1.2); }
  if (e.key.toLowerCase() === 'f') { sankey.fit(); }
  if (e.key.toLowerCase() === 's') { layoutName.focus(); }
  if (e.key.toLowerCase() === 'l') { layoutSelect.focus(); }
});

// ===== CSV helpers =====
function readFileText(file?: File | null): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('no file'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** Простой CSV-парсер с поддержкой кавычек и запятых внутри кавычек */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => { cur.push(cell); cell = ''; };
  const pushRow = () => { rows.push(cur.slice()); cur = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } // escaped quote
        else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') pushCell();
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        pushCell(); pushRow();
      } else {
        cell += ch;
      }
    }
  }
  pushCell();
  if (cur.length > 1 || (cur.length === 1 && cur[0] !== '')) pushRow();
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function headerIndexMap(header: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  header.forEach((h, i) => m[h.trim().toLowerCase()] = i);
  return m;
}

function parseLinksCSV(text: string): SankeyLink[] {
  const rows = parseCSV(text);
  if (rows.length === 0) throw new Error('links.csv пустой');
  const header = rows[0].map(s => s.trim());
  const hi = headerIndexMap(header);

  const need = ['source', 'target', 'value'];
  for (const k of need) if (!(k in hi)) throw new Error(`links.csv: нет колонки "${k}"`);

  const links: SankeyLink[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length) continue;
    const source = r[hi.source]?.trim();
    const target = r[hi.target]?.trim();
    const value = Number(r[hi.value]);
    if (!source || !target || !Number.isFinite(value)) continue;
    const color = hi.color !== undefined ? r[hi.color]?.trim() || undefined : undefined;
    links.push({ source, target, value, color });
  }
  if (!links.length) throw new Error('links.csv: не найдено валидных строк');
  return links;
}

function parseNodesCSV(text: string): SankeyNode[] {
  const rows = parseCSV(text);
  if (rows.length === 0) throw new Error('nodes.csv пустой');
  const header = rows[0].map(s => s.trim());
  const hi = headerIndexMap(header);

  if (!('id' in hi)) throw new Error('nodes.csv: нет колонки "id"');

  const nodes: SankeyNode[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length) continue;

    const id = r[hi.id]?.trim();
    if (!id) continue;

    const label = hi.label !== undefined ? (r[hi.label] || '').trim() || undefined : undefined;
    const color = hi.color !== undefined ? (r[hi.color] || '').trim() || undefined : undefined;

    const x = hi.x !== undefined ? toNum(r[hi.x]) : undefined;
    const y = hi.y !== undefined ? toNum(r[hi.y]) : undefined;
    const width = hi.width !== undefined ? toNum(r[hi.width]) : undefined;
    const height = hi.height !== undefined ? toNum(r[hi.height]) : undefined;

    nodes.push({ id, label, color, x, y, width, height });
  }
  if (!nodes.length) throw new Error('nodes.csv: не найдено валидных строк');
  return nodes;
}

function inferNodesFromLinks(links: SankeyLink[]): SankeyNode[] {
  const ids = new Set<string>();
  for (const l of links) { ids.add(l.source); ids.add(l.target); }
  return Array.from(ids).map(id => ({ id, label: id }));
}

function toNum(s: any): number | undefined {
  if (s === null || s === undefined || String(s).trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
