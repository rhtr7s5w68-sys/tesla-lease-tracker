// Manually log a lease data point — the always-reliable path.
//
// Usage:
//   node scripts/add.mjs <model> <monthly> [dueAtSigning] [termMonths] [milesPerYear] [apr]
//
// Examples:
//   node scripts/add.mjs model-y 449 4155 36 10000
//   node scripts/add.mjs model-y 449 4155 36 10000 6.5
//   node scripts/add.mjs model-y-l 599 5000 36 10000    (first Y L lease appears!)
//
// Mark a model as "no lease offered" for today:
//   node scripts/add.mjs model-y-l none

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "history.json");
const today = () => new Date().toISOString().slice(0, 10);

const [, , model, monthlyArg, dueAtSigning, termMonths, milesPerYear, apr] = process.argv;

if (!model || !monthlyArg) {
  console.error("Usage: node scripts/add.mjs <model> <monthly|none> [dueAtSigning] [termMonths] [milesPerYear] [apr]");
  process.exit(1);
}

const db = JSON.parse(await readFile(DB_PATH, "utf8"));
if (!db.models[model]) {
  console.error(`Unknown model "${model}". Known: ${Object.keys(db.models).join(", ")}`);
  process.exit(1);
}

const date = today();
// Replace an existing snapshot for the same model+date if present.
db.snapshots = db.snapshots.filter((s) => !(s.model === model && s.date === date));

const num = (v) => (v == null || v === "" ? null : Number(v));

if (monthlyArg === "none") {
  db.snapshots.push({
    date, model, trim: db.models[model].name, available: false,
    monthly: null, dueAtSigning: null, termMonths: null, milesPerYear: null,
    acquisitionFee: null, moneyFactor: null, apr: null, source: "manual",
  });
  console.log(`Logged: ${model} — no lease offered on ${date}.`);
} else {
  db.snapshots.push({
    date, model, trim: db.models[model].name, available: true,
    monthly: num(monthlyArg), dueAtSigning: num(dueAtSigning), termMonths: num(termMonths),
    milesPerYear: num(milesPerYear), acquisitionFee: null, moneyFactor: null,
    apr: num(apr), source: "manual",
  });
  console.log(`Logged: ${model} — $${monthlyArg}/mo on ${date}.`);
}

db.snapshots.sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model));
db.meta.lastUpdated = date;
await writeFile(DB_PATH, JSON.stringify(db, null, 2) + "\n");
console.log("Saved to data/history.json.");
