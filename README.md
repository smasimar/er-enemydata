# Elden Ring Enemy Data Browser

A static web app for browsing Elden Ring enemy stats. Data loads live from the [Elden Ring Enemy Data spreadsheet](https://docs.google.com/spreadsheets/d/1BVwmKqB8pvuyJkSTGYOM2kAJxFMQ0jVsc6aKYz_Upes/edit?usp=sharing) (NG tab) on each page load, so spreadsheet updates appear without changes to this repo.

## Features

- Search by **enemy name** and **location** (combined, live filters)
- Defaults to **bosses only**; toggle to show all enemies
- Results list with HP and Boss badges
- Detail view with stats grouped like the spreadsheet headers:
  - Damage Negation (as %, with damage-type icons)
  - Resistances (with status icons)
  - Incoming Status Damage Multipliers
  - Poise
  - Enemy "Part" Damage Multipliers
- Location **Def** chip for the flat difficulty multiplier
- Color-coded negation/resistance values (higher = worse for the player) and Immune badges
- Dark, gold-accent Elden Ring–inspired theme

## How to run

Serve the folder over HTTP (an internet connection is required to load the spreadsheet):

```bash
# Python 3
python -m http.server 8000

# Or Node (if you have npx)
npx --yes serve -p 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Credits

- Enemy data from the [Elden Ring Enemy Data spreadsheet](https://docs.google.com/spreadsheets/d/1BVwmKqB8pvuyJkSTGYOM2kAJxFMQ0jVsc6aKYz_Upes/edit?usp=sharing)
- Icons © FromSoftware / Bandai Namco Entertainment, from [Eldenpedia](https://eldenring.wiki.gg/) (damage-type icon edits by Torbi)

## License

The source code is under the [MIT license](LICENSE). The icons in `icons/` and the enemy data are third-party content and are not under MIT. Refer to [NOTICE.md](NOTICE.md).

ELDEN RING is a trademark of FromSoftware, Inc. and Bandai Namco Entertainment Inc. This is an unofficial fan project, not affiliated with or endorsed by them.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page shell |
| `styles.css` | Theme & layout |
| `app.js` | Live spreadsheet fetch, CSV parse, search, rendering |
| `icons/` | Third-party game icons (not MIT, refer to NOTICE.md) |
| `NOTICE.md` | License scope and third-party content |
