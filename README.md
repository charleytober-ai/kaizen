# Kaizen

A habit and project tracker for a body that gives you a different day every day.

- Each morning, pick the kind of day you're having. Habits show a small or full version to match. Rest days ask nothing.
- Big things are projects, broken into small steps. Only the next step shows.
- Progress is judged by the month, never the day. No streaks, nothing ever taken away.
- Every win drops a pebble in this month's jar.

Everything is stored on the device (`localStorage`). Nothing is sent anywhere. Use **More → Save backup file** to keep a copy.

## Install on Android

Open the site in Chrome, tap the ⋮ menu, then **Add to Home screen** (or **Install app**). It works offline after that.

## Files

Plain HTML, CSS and JavaScript. No build step.

- `index.html`, `style.css`, `app.js`: the app
- `store.js`: the only file that reads or writes saved data
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and install
