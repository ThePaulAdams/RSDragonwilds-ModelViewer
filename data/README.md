# Game data for /crafting and /calculators

The pages load `/gamedata.json`. The server serves `$DATA_DIR/gamedata/gamedata.json` when it exists and falls back to `data/sample-gamedata.json` (hand-written placeholder values, flagged `"sample": true`, shown with a banner on the site).

Shape: see the header of `static/planner-lib.js`. Optional extras: `items[id].icon` (URL path under /assets/), `version`, `runecrafting.{essencePerRun, altars[]}`.
