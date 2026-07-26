/**
 * Elden Ring Enemy Data Browser
 * Parses er-enemydata.csv and provides search + grouped stat views.
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
  { label: "Poison", resist: "Poison", mult: null },
  { label: "Scarlet Rot", resist: "Scarlet Rot", mult: null },
  { label: "Bleed", resist: "Bleed", mult: "Bleed" },
  { label: "Frost", resist: "Frost", mult: "Frost" },
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

// ——— CSV parsing ———

/**
 * Quote-aware CSV line splitter.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
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
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
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
 * @param {string[]} row
 * @param {number} start
 * @param {string[]} keys
 * @returns {Record<string, string|number|null>}
 */
function mapGroup(row, start, keys) {
  /** @type {Record<string, string|number|null>} */
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = parseValue(row[start + i]);
  }
  return out;
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
 * @property {{base: *, incomingMult: *, effective: *, regenDelay: *}} poise
 * @property {Record<string, string|number|null>} parts
 */

/**
 * @param {string} text
 * @returns {Enemy[]}
 */
function parseEnemies(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  // Row 0 = group headers, row 1 = column names, data from row 2
  const enemies = [];

  for (let i = 2; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (!row[1]) continue;

    const name = (row[1] || "").trim();
    const location = (row[0] || "").trim();
    // Defense columns are always identical — a flat location difficulty multiplier
    const defense = /** @type {number|null} */ (parseValue(row[7]));

    enemies.push({
      location,
      name,
      id: String(row[2] || "").trim(),
      health: /** @type {number|null} */ (parseValue(row[4])),
      dlcClear: parseValue(row[5]),
      isBoss: /\[Boss\]/i.test(name),
      defense,
      damageNegation: mapGroup(row, 16, DAMAGE_TYPES),
      resistances: mapGroup(row, 25, RESISTANCE_TYPES),
      statusMults: mapGroup(row, 33, STATUS_MULT_TYPES),
      poise: {
        base: parseValue(row[39]),
        incomingMult: parseValue(row[40]),
        effective: parseValue(row[41]),
        regenDelay: parseValue(row[42]),
      },
      parts: mapGroup(row, 44, PART_LABELS),
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
  return name.replace(/\s*\[Boss\]\s*/gi, "").trim();
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
 * @param {string|number|null} v
 * @returns {string}
 */
function negationClass(v) {
  if (v === null || v === undefined) return "";
  if (typeof v !== "number") return "";
  // Higher negation = harder to damage = worse (red)
  if (v >= 40) return "stat-bad";
  if (v >= 20) return "stat-poor";
  if (v > 0) return "stat-mild-bad";
  if (v === 0) return "stat-neutral";
  if (v > -20) return "stat-good";
  return "stat-great";
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
 * Half-bar fill % for diverging negation bars (0 = empty, 100 = full half toward ±100).
 * @param {string|number|null} v
 * @returns {number}
 */
function negationBarExtent(v) {
  if (typeof v !== "number" || v === 0) return 0;
  return Math.max(0, Math.min(100, Math.abs(v)));
}

/**
 * Bar for resistances (0..700-ish).
 * @param {string|number|null} v
 * @returns {number}
 */
function resistanceBar(v) {
  if (v === "Immune") return 100;
  if (typeof v !== "number") return 0;
  return Math.max(0, Math.min(100, (v / 700) * 100));
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
 * @param {{className?: string, bar?: number, divergingBar?: number, highlight?: boolean, format?: 'percent'|'plain', icon?: boolean}} [opts]
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

  let barHtml = "";
  if (opts.divergingBar !== undefined && typeof opts.divergingBar === "number") {
    const v = opts.divergingBar;
    // extent 0–100 of half-track → convert to % of full bar (max half = 50%)
    const halfPct = negationBarExtent(v) / 2;
    const dir = v > 0 ? "is-pos" : v < 0 ? "is-neg" : "is-zero";
    barHtml = `
      <div class="stat-bar stat-bar-diverging" aria-hidden="true">
        <div class="stat-bar-center"></div>
        <div class="stat-bar-fill ${dir}" style="width:${halfPct}%"></div>
      </div>`;
  } else if (opts.bar !== undefined) {
    barHtml = `<div class="stat-bar" aria-hidden="true"><div class="stat-bar-fill ${cls}" style="width:${opts.bar}%"></div></div>`;
  }

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
 * Merged resistance + incoming status damage multiplier cell.
 * @param {Enemy} enemy
 * @param {{label: string, resist: string|null, mult: string|null}} row
 */
function statusRowCell(enemy, row) {
  const resistVal = row.resist ? enemy.resistances[row.resist] : null;
  const multVal = row.mult ? enemy.statusMults[row.mult] : null;
  const hasResist = row.resist != null;
  const isImmune = resistVal === "Immune";
  const cls = hasResist ? resistanceClass(resistVal) : multClass(multVal);
  const icon = iconHtml(row.label);

  const resistHtml = hasResist
    ? isImmune
      ? `<span class="immune-badge">Immune</span>`
      : `<span class="stat-value">${esc(formatValue(resistVal))}</span>`
    : "";

  const multHtml =
    multVal !== null && multVal !== undefined
      ? `<span class="status-mult ${multClass(multVal)}" title="Incoming status damage multiplier">×${esc(
          formatValue(multVal)
        )}</span>`
      : "";

  const barHtml = hasResist
    ? `<div class="stat-bar" aria-hidden="true"><div class="stat-bar-fill ${cls}" style="width:${resistanceBar(
        resistVal
      )}%"></div></div>`
    : "";

  return `
    <div class="stat-cell status-row ${cls}">
      <span class="stat-label">${icon}<span>${esc(row.label)}</span></span>
      <div class="status-values">
        ${resistHtml}
        ${multHtml}
      </div>
      ${barHtml}
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

  const negationHtml = DAMAGE_TYPES.map((t) => {
    const v = enemy.damageNegation[t];
    return statCell(t, v, {
      className: negationClass(v),
      divergingBar: typeof v === "number" ? v : 0,
      format: "percent",
    });
  }).join("");

  const statusHtml = STATUS_ROWS.map((row) => statusRowCell(enemy, row)).join("");

  const poiseHtml = [
    statCell("Base", enemy.poise.base, { icon: false }),
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
      ${groupCard("Damage Negation", `<div class="stat-grid cols-4">${negationHtml}</div>`, "card-negation")}
      ${groupCard(
        "Resistances",
        `<div class="stat-grid cols-4">${statusHtml}</div>
         <p class="card-hint">Values are build-up resistance; × multipliers are incoming status damage.</p>`,
        "card-resist"
      )}
      ${groupCard("Poise", `<div class="stat-grid cols-4">${poiseHtml}</div>`)}
      ${groupCard('Enemy "Part" Damage Multipliers', `<div class="stat-grid cols-5">${partsHtml}</div>`)}
    </div>
  `;
}

// ——— Init ———

async function init() {
  const countEl = document.getElementById("result-count");
  try {
    const res = await fetch("er-enemydata.csv");
    if (!res.ok) throw new Error(`Failed to load CSV (${res.status})`);
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
        Could not load <code>er-enemydata.csv</code>.<br />
        Serve this folder over HTTP (e.g. <code>python -m http.server</code>) and reload.
      </div>`;
  }
}

init();
