# Translating the YAGCC configurator

The web configurator is translated with one flat JSON file per language in this folder. `en.json` is the source of truth and the fallback: a key that is missing from a language falls back to English, then to the key itself. There is no build step.

| File | Language |
| --- | --- |
| `en.json` | English (source, always loaded) |
| `ja.json` | 日本語 |
| `es.json` | Español |
| `pt-BR.json` | Português (Brasil) |
| `fr.json` | Français |
| `de.json` | Deutsch |
| `zh-CN.json` | 简体中文 |
| `ru.json` | Русский |
| `ko.json` | 한국어 |

The other files start as `{ "_language": "<native name>" }`. Keys that begin with `_` are metadata and are ignored.

## Workflow

1. Copy the keys you want to translate from `en.json` into your language file, keep the key, translate the value.
2. Run `node web/i18n/check.mjs --lang de` (Node 18+, nothing to install). It reports keys that are missing or extra, placeholder and HTML-tag mismatches, and, for `en.json`, keys no source file uses. `--allow-missing` ignores missing keys while a translation is in progress, `--quiet` prints only the summary lines. The exit status is 1 when anything is wrong.
3. Open the configurator with `?lang=de` (`?lang=ja`, `?lang=pt-BR`...) to see the result. The language picker in the header does the same and remembers the choice (`localStorage` key `yagcc.lang`). `?lang=xx` shows the pseudo-locale: every English string in brackets, accented and about 35 % longer. Anything that is still plain English in that view is a string that was not extracted, please report it.

The first visit picks the language from the browser (`navigator.languages`): `zh`, `zh-CN` and `zh-Hans` give 简体中文, `pt` gives Português (Brasil), `ru` gives Русский, `ko` gives 한국어, anything unsupported gives English. Traditional Chinese is not offered, so it falls back to English.

## Keys and values

* Keys are `namespace.something`, for example `setup.tilt.title`. They are stable identifiers, do not rename or translate them.
* Values are plain text, or small HTML where the English value has tags (`<b>`, `<i>`, `<code>`, `<br>`, `<a href=...>`). Keep the same tags in the same number, only the text between them changes. The checker compares them.
* `{name}` placeholders are filled in by the code (`"Clear {name}"`). Keep every placeholder exactly as written; you may move it around the sentence. Do not translate the name inside the braces.
* Numbers are not localised: the code inserts them as digits.

### Plurals

Some keys come as a family: `base.one`, `base.other` (and more for languages that need them). The code picks the form with `Intl.PluralRules` for the current language and passes the count as `{n}`:

```json
"lights.led_count.one": "{n} LED",
"lights.led_count.other": "{n} LEDs"
```

Provide the categories your language uses: Japanese, Korean and Chinese only `other`, German `one` + `other`, Spanish, French and Portuguese `one` + `many` + `other` (`many` is for large round numbers such as 1 000 000: "1 000 000 de pines"; check.mjs asks `Intl.PluralRules` for the exact set), Russian-style languages `one`, `few`, `many`, `other`. `other` is always required. A category that is missing falls back to `other`.

### What is not translated

Leave these as they are, in every language:

* Product, brand and project names: YAGCC, Clone Hero, YARG, Fortnite Festival, Rock Band, Guitar Hero, Raspberry Pi Pico, Santroller, GP2040-CE, XInput, PlayStation, Xbox, Switch...
* Technical identifiers: GPIO numbers and names (`GP26`), LED chip names (WS2812B, APA102), colour orders (RGB, GRB), protocols, file names (`yagcc-pico.uf2`), console and mode identity names.
* Controller button names: A, B, X, Y, LB, RB, LT, RT, LS, RS, Back, Start, Guide, Home, Share, Options, Cross, Circle, Square, Triangle, L1/R1, ZL/ZR...
* Keyboard key names (`Esc`, `Right Shift`, `Page Down`).

Descriptive words around those names are translated: "Left stick up", "Mode default", "Nothing", "(green fret)", "Strum up".

## Tips for translators

* The interface has to cope with text up to about 30 % longer than English and with CJK text; buttons wrap instead of clipping. Short labels are better than literal ones.
* Many strings appear inside a sentence that is built from several keys. Open the page with your language and read it in place.
* Keep punctuation conventions of your language (full-width `。` and `：` in Japanese and Chinese, a space before `:` and `?` in French).

## For developers

* `t(key, vars)` is in `js/i18n.js`. Static HTML uses `data-i18n`, `data-i18n-html`, `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-aria-label` (also `-alt`, `-content`). Never build a sentence by concatenating translated pieces: use one key with `{placeholders}`.
* Module-level tables of labels are wrapped in `localized(() => [...])` so they are rebuilt in place when the language changes. `setLang()` fires a `langchange` event on `document`; the app re-renders the current view from its state, so unsaved settings survive a switch.
* Add a language: add `{ code, name }` to `LANGS` in `js/i18n.js` (and to `matchLang` if its base code is new), create `<code>.json` with `_language`, then run the checker.
* The files are fetched as `i18n/<code>.json?v=dev`; the deploy workflow rewrites the `?v=dev` suffix like it does for the other assets.
