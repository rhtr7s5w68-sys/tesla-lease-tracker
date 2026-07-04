// Daily updater: fetches current Tesla lease offers and appends a snapshot per model.
// Run by GitHub Actions on a schedule, or locally: `node scripts/update.mjs`
//
// Reliability model: Tesla actively blocks scrapers, so this is best-effort.
// - If it gets a confident lease number, it records a snapshot for today.
// - If it can't, it records NOTHING for that model (no fake data) and logs a warning.
// - You can always log a point by hand with scripts/add.mjs — that's the reliable path.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "history.json");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const today = () => new Date().toISOString().slice(0, 10);

// --- Tesla fetch -----------------------------------------------------------
// Attempts to read the public current-offers page and extract the cheapest
// advertised lease payment per model. Selectors/patterns may need updating if
// Tesla changes their page; failures are handled gracefully.
async function fetchTeslaOffers() {
  const out = {};
  let html = "";
  try {
    const res = await fetch("https://www.tesla.com/current-offers", {
      headers: { "User-Agent": UA, "Accept": "text/html" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    html = await res.text();
  } catch (e) {
    console.warn("[warn] could not fetch tesla.com/current-offers:", e.message);
    return out;
  }

  // Look for embedded JSON offer blobs, then fall back to text patterns.
  // Pattern: lease amounts near a model name, e.g. "Model Y ... $459 /mo".
  const findLease = (modelName) => {
    const idx = html.indexOf(modelName);
    if (idx === -1) return null;
    const window = html.slice(idx, idx + 4000);
    // Prefer explicit lease fields if present in embedded JSON.
    const jsonMatch = window.match(/"lease(?:From|Price|Monthly)"\s*:\s*"?\$?(\d{3,4})/i);
    if (jsonMatch) return Number(jsonMatch[1]);
    // Otherwise the first "$XXX/mo" near the model heading.
    const txtMatch = window.match(/\$\s?(\d{3,4})\s*(?:\/mo|per month|a month)/i);
    if (txtMatch) return Number(txtMatch[1]);
    return null;
  };

  const y = findLease("Model Y");
  if (y != null) out["model-y"] = { monthly: y };
  const yl = findLease("Model Y L");
  if (yl != null) out["model-y-l"] = { monthly: yl };

  return out;
}

// --- main ------------------------------------------------------------------
async function main() {
  const db = JSON.parse(await readFile(DB_PATH, "utf8"));
  const date = today();
  const offers = await fetchTeslaOffers();

  let changed = false;
  for (const modelKey of Object.keys(db.models)) {
    const already = db.snapshots.some((s) => s.model === modelKey && s.date === date);
    if (already) { console.log(`[skip] ${modelKey} already has a ${date} snapshot`); continue; }

    const found = offers[modelKey];
    if (!found || found.monthly == null) {
      console.warn(`[warn] no confident lease figure for ${modelKey} today — not recording.`);
      continue;
    }

    // Carry forward structural fields (term, due-at-signing) from the last known
    // snapshot of this model; only the monthly changes day to day in the auto feed.
    const prev = [...db.snapshots].reverse().find((s) => s.model === modelKey && s.available);
    db.snapshots.push({
      date,
      model: modelKey,
      trim: prev?.trim ?? "Base",
      available: true,
      monthly: found.monthly,
      dueAtSigning: found.dueAtSigning ?? prev?.dueAtSigning ?? null,
      termMonths: found.termMonths ?? prev?.termMonths ?? null,
      milesPerYear: found.milesPerYear ?? prev?.milesPerYear ?? null,
      acquisitionFee: found.acquisitionFee ?? prev?.acquisitionFee ?? null,
      moneyFactor: found.moneyFactor ?? null,
      apr: found.apr ?? null,
      source: "tesla.com/current-offers (auto)",
    });
    console.log(`[ok] recorded ${modelKey}: $${found.monthly}/mo`);
    changed = true;
  }

  if (changed) {
    db.meta.lastUpdated = date;
    await writeFile(DB_PATH, JSON.stringify(db, null, 2) + "\n");
    console.log("[done] history.json updated.");
  } else {
    console.log("[done] no changes.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
