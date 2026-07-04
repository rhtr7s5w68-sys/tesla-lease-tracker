# Tesla Lease Deal Tracker

Tracks **Model Y** and **Model Y L** (US) lease offers, builds price + interest **history**,
and tells you **when it's a good time to lease** with a per-model deal score.

- **Site:** static page (`index.html`) with charts — hostable free on GitHub Pages.
- **Data:** daily JSON snapshots in `data/history.json`.
- **Automation:** a GitHub Action fetches Tesla's current offers once a day and commits a snapshot.

## How the deal score works

Each day the tracker records the cheapest advertised lease per model. It computes a
**true monthly cost** (`due-at-signing + remaining payments ÷ term`) so offers with different
down payments compare fairly, then rates today's offer against everything it has seen:

- 🟢 **Best deal on record** — today matches the lowest true cost ever seen
- 🟢 **Near the best** — within 2% of the low
- 🟡 **Below average** — cheaper than the median
- 🟠 **Above average — consider waiting**

History builds **forward** from the first snapshot — Tesla doesn't publish past lease rates,
so the longer it runs, the smarter the "best in N days" call gets.

## Model Y L

Launched July 2, 2026 ($61,990 Launch Series). Tesla has **not** opened leasing on it yet,
so the tracker shows it as "watching" and will flag the first lease offer the day it appears.

## Running / updating

```bash
# View locally
python3 -m http.server 8000     # then open http://localhost:8000

# Log a data point by hand (always reliable):
node scripts/add.mjs model-y 449 4155 36 10000        # $449/mo, $4155 down, 36mo, 10k mi/yr
node scripts/add.mjs model-y 449 4155 36 10000 6.5    # ...with 6.5% APR
node scripts/add.mjs model-y-l 599 5000 36 10000      # first Y L lease shows up
node scripts/add.mjs model-y-l none                    # record "no lease offered today"

# Try the automated fetch:
node scripts/update.mjs
```

## Data format (`data/history.json`)

Each snapshot: `date`, `model`, `trim`, `available`, `monthly`, `dueAtSigning`,
`termMonths`, `milesPerYear`, `acquisitionFee`, `moneyFactor`, `apr`, `source`.

## A note on the automated fetch

Tesla actively blocks scrapers and changes their pages often, so `scripts/update.mjs` is
**best-effort**: it records a snapshot only when it extracts a confident number, and never
writes fake data. The reliable path is `scripts/add.mjs` — a 5-second manual log whenever
you check tesla.com. Both feed the same history and charts.
