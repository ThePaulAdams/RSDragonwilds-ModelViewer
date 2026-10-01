# Game data for /crafting and /calculators

The pages load `/gamedata/crafting.json` (served from the repo's `gamedata/` folder by the game data route) and fall back to `/sample-gamedata.json` (`data/sample-gamedata.json`: hand-written placeholder values, flagged `"sample": true`, shown with a banner on the site).

Shape: see the header of `static/planner-lib.js`. Optional extras: `items[id].icon` (URL path under /assets/), `version`, `runecrafting.{essencePerRun, altars[]}`.
