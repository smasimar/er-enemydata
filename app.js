/**
 * Elden Ring Enemy Data Browser
 * Loads live data from the Elden Ring Enemy Data spreadsheet and provides search + grouped stat views.
 */

const DAMAGE_TYPES = ["Phys", "Strike", "Slash", "Pierce", "Magic", "Fire", "Ltng", "Holy"];
const RESISTANCE_TYPES = [
  "Poison",
  "Scarlet Rot",
  "Bleed",
  "Frost",
  "Sleep",
  "Madness",
  "Deathblight",
];
const STATUS_MULT_TYPES = ["Bleed", "Frost", "Sleep", "Madness", "HP Burn Effect"];
/** Combined resistance + status-mult rows for the merged Resistances card. */
const STATUS_ROWS = [
  { label: "Bleed", resist: "Bleed", mult: "Bleed" },
  { label: "Frost", resist: "Frost", mult: "Frost" },
  { label: "Scarlet Rot", resist: "Scarlet Rot", mult: null },
  { label: "Poison", resist: "Poison", mult: null },
  { label: "Sleep", resist: "Sleep", mult: "Sleep" },
  { label: "Madness", resist: "Madness", mult: "Madness" },
  { label: "Deathblight", resist: "Deathblight", mult: null },
  { label: "HP Burn Effect", resist: null, mult: "HP Burn Effect" },
];
const PART_LABELS = [
  "Part 1",
  "Part 2",
  "Part 3",
  "Part 4",
  "Part 5",
  "Part 6",
  "Part 7",
  "Part 8",
  "Weak Part",
  "Parts Damage Type",
];

/** @type {Record<string, string>} */
const DAMAGE_ICONS = {
  Phys: "icons/ER_Custom_Stat_Icon_Defense_Standard.png",
  Strike: "icons/ER_Custom_Stat_Icon_Defense_Strike.png",
  Slash: "icons/ER_Custom_Stat_Icon_Defense_Slash.png",
  Pierce: "icons/ER_Custom_Stat_Icon_Defense_Pierce.png",
  Magic: "icons/ER_Custom_Stat_Icon_Defense_Magic.png",
  Fire: "icons/ER_Custom_Stat_Icon_Defense_Fire.png",
  Ltng: "icons/ER_Custom_Stat_Icon_Defense_Lightning.png",
  Holy: "icons/ER_Custom_Stat_Icon_Defense_Holy.png",
};

/** @type {Record<string, string>} */
const STATUS_ICONS = {
  Poison: "icons/Poison.png",
  "Scarlet Rot": "icons/Scarlet_Rot.png",
  Bleed: "icons/Blood_Loss.webp",
  Frost: "icons/Frostbite.png",
  Sleep: "icons/Sleep.png",
  Madness: "icons/Madness.png",
  Deathblight: "icons/Death_Blight.png",
};

const RESIST_SCALE = 1500;

/** Build-up reference marks. `repeat` = every multiple of small, large at multiples of large. */
const RESIST_NOTCH_CFG = {
  "Scarlet Rot": { small: 195, large: 390, repeat: true },
  Frost: { small: 330, large: 660, repeat: true },
  Bleed: { small: 150, large: 300, repeat: true },
};

/** Color step = large/"full" notch for bleed, frost, and rot. */
const RESIST_COLOR_STEP = {
  "Scarlet Rot": 390,
  Frost: 660,
  Bleed: 300,
};

const PAGE_SIZE = 80;

/** @type {Enemy[]} */
let allEnemies = [];
/** @type {Enemy[]} */
let filteredEnemies = [];
let selectedId = null;
let renderLimit = PAGE_SIZE;
let debounceTimer = null;
/** When false (default), only bosses are listed. */
let showAllEnemies = false;

// ——— Data source ———

/** Live CSV export of the "NG" tab of the Elden Ring Enemy Data spreadsheet. */
const SHEET_ID = "1BVwmKqB8pvuyJkSTGYOM2kAJxFMQ0jVsc6aKYz_Upes";
const SHEET_GID = "0";
const DATA_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

// ——— CSV parsing ———

/**
 * Quote-aware CSV parser (handles escaped quotes and newlines inside quotes).
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(current);
      current = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "" || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

/**
 * @param {string} raw
 * @returns {string|number|null}
 */
function parseValue(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === "" || s === "-") return null;
  if (/^immune$/i.test(s)) return "Immune";

  // Strip thousands separators from quoted numbers like "21,948"
  const normalized = s.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }
  return s;
}

/**
 * @typedef {object} Enemy
 * @property {string} location
 * @property {string} name
 * @property {string} id
 * @property {number|null} health
 * @property {string|number|null} dlcClear
 * @property {boolean} isBoss
 * @property {number|null} defense  Location difficulty multiplier (flat; same across damage types)
 * @property {Record<string, string|number|null>} damageNegation
 * @property {Record<string, string|number|null>} resistances
 * @property {Record<string, string|number|null>} statusMults
 * @property {{base: *, armor: *, incomingMult: *, effective: *, regenDelay: *}} poise
 * @property {Record<string, string|number|null>} parts
 */

/**
 * Build a column lookup from the two header rows.
 * Row 0 holds group names (e.g. "Damage Negation") at the first column of each group;
 * row 1 holds column names. Keys are "Group::Column" and plain "Column" (first match).
 * @param {string[]} groupRow
 * @param {string[]} nameRow
 * @returns {(group: string|null, name: string) => number}
 */
function buildColumnIndex(groupRow, nameRow) {
  /** @type {Map<string, number>} */
  const map = new Map();
  let group = "";
  for (let i = 0; i < nameRow.length; i++) {
    const g = (groupRow[i] || "").trim();
    if (g) group = g;
    const name = (nameRow[i] || "").trim();
    if (!name) continue;
    const grouped = `${group}::${name}`;
    if (!map.has(grouped)) map.set(grouped, i);
    if (!map.has(name)) map.set(name, i);
  }
  return (groupName, name) => {
    if (groupName) {
      for (const [key, idx] of map) {
        const [g, n] = key.split("::");
        if (n === name && g !== undefined && g.toLowerCase().startsWith(groupName.toLowerCase())) return idx;
      }
      return -1;
    }
    return map.has(name) ? /** @type {number} */ (map.get(name)) : -1;
  };
}

/**
 * @param {string} text
 * @returns {Enemy[]}
 */
function parseEnemies(text) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new Error("Spreadsheet has no header rows");
  // Row 0 = group headers, row 1 = column names, data from row 2
  const col = buildColumnIndex(rows[0], rows[1]);

  /** @param {string|null} group @param {string} name */
  const need = (group, name) => {
    const idx = col(group, name);
    if (idx < 0) throw new Error(`Missing column "${group ? group + " › " : ""}${name}"`);
    return idx;
  };
  /** @param {string} group @param {string[]} keys */
  const groupCols = (group, keys) => keys.map((k) => [k, col(group, k)]);
  /** @param {string[]} row @param {Array<[string, number]>} cols */
  const mapCols = (row, cols) => {
    /** @type {Record<string, string|number|null>} */
    const out = {};
    for (const [k, idx] of cols) out[k] = idx < 0 ? null : parseValue(row[idx]);
    return out;
  };

  const cLocation = need(null, "Location");
  const cName = need(null, "Name");
  const cId = col(null, "Npc_ID") >= 0 ? col(null, "Npc_ID") : need(null, "ID");
  const cHealth = need(null, "Health");
  const cDlc = col(null, "dlcClear");
  // Defense columns are always identical — a flat location difficulty multiplier
  const cDefense = need("Defense", "Phys");
  const negationCols = groupCols("Damage Negation", DAMAGE_TYPES);
  const resistCols = groupCols("Resistances", RESISTANCE_TYPES);
  const multCols = groupCols("Incoming Status", STATUS_MULT_TYPES);
  const poiseCols = groupCols("Poise", ["Base", "Armor", "Incoming Mult", "Effective", "Regen Delay"]);
  const partCols = groupCols("Enemy", PART_LABELS);

  const enemies = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[cName] || "").trim();
    if (!name) continue;
    const poise = mapCols(row, poiseCols);

    enemies.push({
      location: (row[cLocation] || "").trim(),
      name,
      id: String(row[cId] || "").trim(),
      health: /** @type {number|null} */ (parseValue(row[cHealth])),
      dlcClear: cDlc < 0 ? null : parseValue(row[cDlc]),
      isBoss: /\[Boss\]/i.test(name),
      defense: /** @type {number|null} */ (parseValue(row[cDefense])),
      damageNegation: mapCols(row, negationCols),
      resistances: mapCols(row, resistCols),
      statusMults: mapCols(row, multCols),
      poise: {
        base: poise["Base"],
        armor: poise["Armor"],
        incomingMult: poise["Incoming Mult"],
        effective: poise["Effective"],
        regenDelay: poise["Regen Delay"],
      },
      parts: mapCols(row, partCols),
    });
  }

  return enemies;
}

// ——— Formatting helpers ———

/**
 * @param {string|number|null|undefined} v
 * @returns {string}
 */
function formatValue(v) {
  if (v === null || v === undefined) return "—";
  if (v === "Immune") return "Immune";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return String(v);
  }
  return String(v);
}

/**
 * @param {string|number|null|undefined} v
 * @returns {string}
 */
function formatPercent(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return `${formatValue(v)}%`;
  return String(v);
}

/**
 * @param {string} name
 * @returns {string}
 */
function displayName(name) {
  return name.replace(/\s*\[Boss\]\s*/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Wiki search query: strip [Boss] and any parenthetical segments.
 * e.g. "Fell Twin (Axe)" → "Fell Twin"
 * @param {string} name
 * @returns {string}
 */
function wikiSearchName(name) {
  return displayName(name)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Escape HTML text.
 * @param {string|number|null|undefined} s
 * @returns {string}
 */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Icon HTML for a damage type or status, if available.
 * @param {string} label
 * @returns {string}
 */
function iconHtml(label) {
  const src = DAMAGE_ICONS[label] || STATUS_ICONS[label];
  if (!src) return "";
  return `<img class="stat-icon" src="${esc(src)}" alt="" width="22" height="22" loading="lazy" />`;
}

/**
 * Color for damage negation: higher = worse for the player (enemy absorbs more).
 * Thresholds: ≤10 grey, ≤20 muted salmon, ≤40 muted rust, above that deep dark red.
 * @param {string|number|null} v
 * @returns {string}
 */
function negationClass(v) {
  if (v === null || v === undefined) return "";
  if (typeof v !== "number") return "";
  if (v === 0) return "stat-neutral";
  if (v > 0) {
    if (v <= 10) return "stat-neutral";
    if (v <= 20) return "stat-neg-2";
    if (v <= 40) return "stat-neg-3";
    return "stat-neg-4";
  }
  if (v >= -10) return "stat-neutral";
  if (v >= -20) return "stat-neg-g2";
  if (v >= -40) return "stat-neg-g3";
  return "stat-neg-g4";
}

/**
 * Color for resistances: higher = worse (harder to apply status).
 * @param {string|number|null} v
 * @returns {string}
 */
function resistanceClass(v) {
  if (v === "Immune") return "stat-immune";
  if (v === null || v === undefined || typeof v !== "number") return "";
  if (v >= 500) return "stat-bad";
  if (v >= 300) return "stat-poor";
  if (v >= 200) return "stat-mild-bad";
  if (v >= 100) return "stat-neutral";
  return "stat-good";
}

/**
 * Bleed / frost / rot: green below 1 big notch; then the negation palette.
 * Grey only for Immune.
 * @param {string} label
 * @param {string|number|null} v
 * @returns {string}
 */
function resistanceBarClass(label, v) {
  if (v === "Immune") return "stat-immune";
  const step = RESIST_COLOR_STEP[label];
  if (!step || typeof v !== "number") return resistanceClass(v);
  const n = Math.floor(v / step);
  if (n <= 0) return "stat-good";
  if (n === 1) return "stat-neg-2";
  if (n === 2) return "stat-neg-3";
  return "stat-neg-4";
}

/**
 * Class for status multiplier (lower = more resistant to status damage on self).
 * @param {string|number|null} v
 * @returns {string}
 */
function multClass(v) {
  if (v === null || v === undefined || typeof v !== "number") return "";
  if (v < 1) return "stat-good";
  if (v === 1) return "stat-neutral";
  return "stat-poor";
}

/**
 * ±50% zoom unless any negation is outside ±40%.
 * @param {Enemy} enemy
 * @returns {number}
 */
function negationScale(enemy) {
  const zoomOut = DAMAGE_TYPES.some((t) => {
    const v = enemy.damageNegation[t];
    return typeof v === "number" && Math.abs(v) > 40;
  });
  return zoomOut ? 100 : 50;
}

/**
 * Width of one half of a diverging track (0–50% of full width).
 * @param {string|number|null} v
 * @param {number} scale
 * @returns {number}
 */
function negationBarWidth(v, scale) {
  if (typeof v !== "number" || v === 0) return 0;
  return Math.max(0, Math.min(50, (Math.abs(v) / scale) * 50));
}

/**
 * Bar for resistances (0..RESIST_SCALE). Immune fills the track.
 * @param {string|number|null} v
 * @returns {number}
 */
function resistanceBar(v) {
  if (v === "Immune") return 100;
  if (typeof v !== "number") return 0;
  return Math.max(0, Math.min(100, (v / RESIST_SCALE) * 100));
}

/**
 * @param {string} label
 * @returns {string}
 */
function resistanceNotches(label) {
  const cfg = RESIST_NOTCH_CFG[label];
  if (!cfg) return "";

  /** @type {{at: number, size: string}[]} */
  const marks = [];
  if (cfg.repeat) {
    for (let at = cfg.small; at <= RESIST_SCALE; at += cfg.small) {
      const isLarge = cfg.large && at % cfg.large === 0;
      marks.push({ at, size: isLarge ? "lg" : "sm" });
    }
  } else {
    if (cfg.small <= RESIST_SCALE) marks.push({ at: cfg.small, size: "sm" });
    if (cfg.large && cfg.large !== cfg.small && cfg.large <= RESIST_SCALE) {
      marks.push({ at: cfg.large, size: "lg" });
    }
  }

  return marks
    .map((m) => {
      const pct = Math.max(0, Math.min(100, (m.at / RESIST_SCALE) * 100));
      return `<span class="chart-notch chart-notch-${m.size}" style="left:${pct}%" title="${m.at}"></span>`;
    })
    .join("");
}

// ——— Search & list ———

function getFilters() {
  const nameQ = /** @type {HTMLInputElement} */ (document.getElementById("name-search")).value
    .trim()
    .toLowerCase();
  const locQ = /** @type {HTMLInputElement} */ (document.getElementById("location-search")).value
    .trim()
    .toLowerCase();
  return { nameQ, locQ };
}

function applyFilters() {
  const { nameQ, locQ } = getFilters();
  filteredEnemies = allEnemies
    .filter((e) => {
      if (!showAllEnemies && !e.isBoss) return false;
      if (nameQ && !e.name.toLowerCase().includes(nameQ)) return false;
      if (locQ && !e.location.toLowerCase().includes(locQ)) return false;
      return true;
    })
    .sort((a, b) => {
      const da = a.defense == null ? Number.POSITIVE_INFINITY : a.defense;
      const db = b.defense == null ? Number.POSITIVE_INFINITY : b.defense;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
  renderLimit = PAGE_SIZE;
  renderResults();
}

function scheduleFilter() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 120);
}

function updateToggleButton() {
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById("show-all-toggle"));
  if (!btn) return;
  btn.setAttribute("aria-pressed", showAllEnemies ? "true" : "false");
  btn.textContent = showAllEnemies ? "Show all" : "Bosses only";
  btn.classList.toggle("is-all", showAllEnemies);
}

function uniqueKey(enemy, index) {
  return `${enemy.id}::${enemy.location}::${enemy.name}::${index}`;
}

function poolSize() {
  return showAllEnemies ? allEnemies.length : allEnemies.filter((e) => e.isBoss).length;
}

function poolLabel() {
  return showAllEnemies ? "enemies" : "bosses";
}

function renderResults() {
  const list = document.getElementById("results-list");
  const countEl = document.getElementById("result-count");
  const scrollTop = list.scrollTop;
  const total = filteredEnemies.length;
  const shown = Math.min(renderLimit, total);
  const pool = poolSize();
  const label = poolLabel();
  const { nameQ, locQ } = getFilters();
  const searching = Boolean(nameQ || locQ);

  if (!searching && total === pool) {
    countEl.textContent = `${total.toLocaleString()} ${label}`;
  } else {
    countEl.textContent = `${total.toLocaleString()} of ${pool.toLocaleString()} ${label}`;
  }

  if (total === 0) {
    list.innerHTML = `<div class="results-empty">No ${label} match your search.</div>`;
    return;
  }

  const slice = filteredEnemies.slice(0, shown);
  const html = slice
    .map((e, i) => {
      const key = uniqueKey(e, i);
      const selected = selectedId === key ? " is-selected" : "";
      const boss = e.isBoss ? `<span class="badge badge-boss">Boss</span>` : "";
      return `
        <button
          type="button"
          class="result-row${selected}"
          role="option"
          data-key="${esc(key)}"
          data-index="${i}"
          aria-selected="${selected ? "true" : "false"}"
        >
          <span class="result-name"><span class="result-name-text">${esc(displayName(e.name))}</span>${boss}</span>
          <span class="result-meta">
            <span class="result-location">${esc(e.location)}</span>
            <span class="result-hp">HP ${esc(formatValue(e.health))}</span>
          </span>
        </button>`;
    })
    .join("");

  const more =
    shown < total
      ? `<button type="button" class="load-more" id="load-more">Show more (${(
          total - shown
        ).toLocaleString()} remaining)</button>`
      : "";

  list.innerHTML = html + more;
  list.scrollTop = scrollTop;

  list.querySelectorAll(".result-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.getAttribute("data-index"));
      const enemy = filteredEnemies[index];
      selectedId = uniqueKey(enemy, index);
      list.querySelectorAll(".result-row").forEach((row) => {
        const isSel = row.getAttribute("data-key") === selectedId;
        row.classList.toggle("is-selected", isSel);
        row.setAttribute("aria-selected", isSel ? "true" : "false");
      });
      renderDetail(enemy);
    });
  });

  const loadMore = document.getElementById("load-more");
  if (loadMore) {
    loadMore.addEventListener("click", () => {
      renderLimit += PAGE_SIZE;
      renderResults();
    });
  }
}

function populateLocationDatalist() {
  const locations = [...new Set(allEnemies.map((e) => e.location))].sort((a, b) =>
    a.localeCompare(b)
  );
  const dl = document.getElementById("location-list");
  dl.innerHTML = locations.map((loc) => `<option value="${esc(loc)}"></option>`).join("");
}

// ——— Detail rendering ———

/**
 * @param {string} label
 * @param {string|number|null} value
 * @param {{className?: string, bar?: number, highlight?: boolean, format?: 'percent'|'plain', icon?: boolean}} [opts]
 */
function statCell(label, value, opts = {}) {
  const cls = opts.className || "";
  const highlight = opts.highlight ? " is-highlight" : "";
  const isImmune = value === "Immune";
  const display =
    opts.format === "percent" ? formatPercent(value) : formatValue(value);
  const valueHtml = isImmune
    ? `<span class="immune-badge">Immune</span>`
    : `<span class="stat-value">${esc(display)}</span>`;

  const barHtml =
    opts.bar !== undefined
      ? `<div class="stat-bar" aria-hidden="true"><div class="stat-bar-fill ${cls}" style="width:${opts.bar}%"></div></div>`
      : "";

  const icon = opts.icon !== false ? iconHtml(label) : "";

  return `
    <div class="stat-cell${highlight} ${cls}">
      <span class="stat-label">${icon}<span>${esc(label)}</span></span>
      ${valueHtml}
      ${barHtml}
    </div>`;
}

/**
 * @param {string} title
 * @param {string} bodyHtml
 * @param {string} [extraClass]
 */
function groupCard(title, bodyHtml, extraClass = "") {
  return `
    <article class="stat-card ${extraClass}">
      <h3 class="stat-card-title">${esc(title)}</h3>
      <div class="stat-card-body">${bodyHtml}</div>
    </article>`;
}

/**
 * Combined diverging bar chart for all damage-negation types.
 * @param {Enemy} enemy
 */
function negationChart(enemy) {
  const scale = negationScale(enemy);
  const rows = DAMAGE_TYPES.map((t) => {
    const v = enemy.damageNegation[t];
    const cls = negationClass(v);
    const n = typeof v === "number" ? v : 0;
    const dir = n > 0 ? "is-pos" : n < 0 ? "is-neg" : "is-zero";
    return `
      <div class="chart-row ${cls}">
        <div class="chart-label">${iconHtml(t)}<span>${esc(t)}</span></div>
        <div class="chart-track chart-track-diverging" aria-hidden="true">
          <div class="chart-center"></div>
          <div class="chart-fill ${dir} ${cls}" style="width:${negationBarWidth(n, scale)}%"></div>
        </div>
        <div class="chart-value">${esc(formatPercent(v))}</div>
      </div>`;
  }).join("");

  return `
    <div class="chart" role="img" aria-label="Damage negation by type">
      ${rows}
      <div class="chart-axis" aria-hidden="true">
        <div class="chart-axis-track">
          <span>−${scale}%</span>
          <span>0</span>
          <span>+${scale}%</span>
        </div>
      </div>
    </div>`;
}

/**
 * Combined bar chart for resistances and status-damage multipliers.
 * @param {Enemy} enemy
 */
function resistanceChart(enemy) {
  const rows = STATUS_ROWS.map((row) => {
    const resistVal = row.resist ? enemy.resistances[row.resist] : null;
    const multVal = row.mult ? enemy.statusMults[row.mult] : null;
    const hasResist = row.resist != null;
    const isImmune = resistVal === "Immune";
    const cls = hasResist ? resistanceBarClass(row.label, resistVal) : multClass(multVal);

    const resistHtml = hasResist
      ? isImmune
        ? `<span class="chart-num chart-imn" title="Immune">IMN</span>`
        : `<span class="chart-num">${esc(formatValue(resistVal))}</span>`
      : `<span class="chart-num chart-num-empty"></span>`;
    const showMult = !isImmune && multVal !== null && multVal !== undefined;
    const multHtml = showMult
      ? `<span class="status-mult ${multClass(multVal)}" title="Incoming status damage multiplier">×${esc(
          formatValue(multVal)
        )}</span>`
      : `<span class="status-mult status-mult-empty"></span>`;

    const notches = !isImmune && RESIST_NOTCH_CFG[row.label];
    const barHtml = hasResist
      ? `<div class="chart-track${notches ? " chart-track-notches" : ""}" aria-hidden="true">
          <div class="chart-fill ${cls}" style="width:${resistanceBar(resistVal)}%"></div>
          ${notches ? resistanceNotches(row.label) : ""}
        </div>`
      : `<div class="chart-track chart-track-empty" aria-hidden="true"></div>`;

    return `
      <div class="chart-row chart-row-resist ${cls}">
        <div class="chart-label">${iconHtml(row.label)}<span>${esc(row.label)}</span></div>
        ${barHtml}
        <div class="chart-value">${resistHtml}</div>
        <div class="chart-mult">${multHtml}</div>
      </div>`;
  }).join("");

  return `
    <div class="chart" role="img" aria-label="Status resistances">
      ${rows}
      <p class="card-hint">Values are build-up resistance; × multipliers are incoming status damage.</p>
    </div>`;
}

/**
 * @param {Enemy} enemy
 */
function renderDetail(enemy) {
  const panel = document.getElementById("detail-panel");
  const name = displayName(enemy.name);
  const wikiQuery = wikiSearchName(enemy.name);
  const wikiUrl = `https://eldenring.wiki.gg/wiki/Special:Search?search=${encodeURIComponent(wikiQuery)}`;
  const bossBadge = enemy.isBoss ? `<span class="badge badge-boss">Boss</span>` : "";

  const negationHtml = negationChart(enemy);
  const statusHtml = resistanceChart(enemy);

  const poiseHtml = [
    statCell("Base", enemy.poise.base, { icon: false }),
    statCell("Armor", enemy.poise.armor, { icon: false }),
    statCell("Incoming Mult", enemy.poise.incomingMult, { icon: false }),
    statCell("Effective", enemy.poise.effective, { icon: false }),
    statCell("Regen Delay", enemy.poise.regenDelay, { icon: false }),
  ].join("");

  const partsHtml = PART_LABELS.map((t) => {
    const v = enemy.parts[t];
    const isWeak = t === "Weak Part";
    return statCell(t, v, {
      highlight: isWeak,
      className: isWeak && typeof v === "number" && v !== 1 ? "stat-weak-part" : "",
      icon: false,
    });
  }).join("");

  const defenseLabel =
    enemy.defense !== null && enemy.defense !== undefined
      ? `<span class="defense-chip" title="Location difficulty multiplier">Def ${esc(
          formatValue(enemy.defense)
        )}</span>`
      : "";

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <h2 class="detail-name">
          <a class="detail-name-link" href="${esc(wikiUrl)}" target="_blank" rel="noopener noreferrer" title="Search wiki for ${esc(wikiQuery)}">${esc(name)}<svg class="external-link-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
          ${bossBadge}
        </h2>
        <p class="detail-location">
          <span class="location-text">${esc(enemy.location)}</span>
          ${defenseLabel}
        </p>
      </div>
      <div class="detail-basics">
        <div class="basic-stat">
          <span class="basic-label">Health</span>
          <span class="basic-value">${esc(formatValue(enemy.health))}</span>
        </div>
        <div class="basic-stat">
          <span class="basic-label">ID</span>
          <span class="basic-value mono">${esc(enemy.id)}</span>
        </div>
      </div>
    </div>

    <div class="stat-groups">
      <div class="stat-charts">
        ${groupCard("Damage Negation", negationHtml, "card-negation")}
        ${groupCard("Resistances", statusHtml, "card-resist")}
      </div>
      ${groupCard("Poise", `<div class="stat-grid cols-5">${poiseHtml}</div>`)}
      ${groupCard('Enemy "Part" Damage Multipliers', `<div class="stat-grid cols-5">${partsHtml}</div>`)}
    </div>
  `;
}

// ——— Init ———

async function init() {
  const countEl = document.getElementById("result-count");
  try {
    countEl.textContent = "Loading live data…";
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load spreadsheet (${res.status})`);
    const text = await res.text();
    allEnemies = parseEnemies(text);
    updateToggleButton();
    populateLocationDatalist();
    applyFilters();

    document.getElementById("name-search").addEventListener("input", scheduleFilter);
    document.getElementById("location-search").addEventListener("input", scheduleFilter);
    document.getElementById("show-all-toggle").addEventListener("click", () => {
      showAllEnemies = !showAllEnemies;
      updateToggleButton();
      applyFilters();
    });

    const list = document.getElementById("results-list");
    list.addEventListener("scroll", () => {
      if (renderLimit >= filteredEnemies.length) return;
      const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 120;
      if (nearBottom) {
        renderLimit += PAGE_SIZE;
        renderResults();
      }
    });
  } catch (err) {
    console.error(err);
    countEl.textContent = "Failed to load data";
    document.getElementById("results-list").innerHTML = `
      <div class="results-empty">
        Could not load live data from the
        <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit" target="_blank" rel="noopener noreferrer">spreadsheet</a>.<br />
        Check your connection and reload.<br />
        <small>${esc(err instanceof Error ? err.message : String(err))}</small>
      </div>`;
  }
}

init();
