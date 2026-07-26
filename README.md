# Elden Ring Enemy Data Browser

A static web app for browsing Elden Ring enemy stats from `er-enemydata.csv`.

## Features

- Search by **enemy name** and **location** (combined, live filters)
- Defaults to **bosses only**; toggle to show all enemies
- Results list with HP and Boss badges
- Detail view with stats grouped like the CSV headers:
  - Damage Negation (as %, with damage-type icons)
  - Resistances (with status icons)
  - Incoming Status Damage Multipliers
  - Poise
  - Enemy "Part" Damage Multipliers
- Location **Def** chip for the flat difficulty multiplier
- Color-coded negation/resistance values (higher = worse for the player) and Immune badges
- Dark, gold-accent Elden Ring–inspired theme

## How to run

Browsers block `fetch()` of local files over `file://`, so serve the folder over HTTP:

```bash
# Python 3
python -m http.server 8000

# Or Node (if you have npx)
npx --yes serve -p 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Credits

Enemy data from the [Elden Ring Enemy Data spreadsheet](https://docs.google.com/spreadsheets/d/1BVwmKqB8pvuyJkSTGYOM2kAJxFMQ0jVsc6aKYz_Upes/edit?usp=sharing).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page shell |
| `styles.css` | Theme & layout |
| `app.js` | CSV parse, search, rendering |
| `er-enemydata.csv` | Source data |
