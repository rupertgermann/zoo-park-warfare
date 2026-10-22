# Glossary

**Game event**: something that happened in a match (`ko`, `damage`, `special`, `bossLand`, ...), announced by `game.js` and heard through `g.on(type, fn)`. The rules only say what happened; the HUD (`ui.js`), the bot chat and `sounds.js` decide how it looks and sounds. _Avoid_: callback, hook, cue.
