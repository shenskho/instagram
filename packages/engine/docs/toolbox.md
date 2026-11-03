# Director toolbox (v0.2)

This is the vocabulary the director may use in an edit plan. It is written to be pasted into the
director prompt in step 3. Screen space is 1080x1920. Times are SOURCE seconds, except elements
with `role`, whose `at`/`dur` count from the start of that timeline segment.

## Timeline segments (`timeline[]`)
| field | values | use |
|---|---|---|
| `src` | `[t0, t1]` | part of the raw video to show (cut pauses by leaving gaps) |
| `role` | none · `cold_open` · `rewind` | `cold_open` = flash-forward of the payoff at 0s; `rewind` = replay a range backwards |
| `reverse`, `speed` | bool, int | for `rewind` (speed 4 ≈ 0.7s for 3s of footage) |
| `zoom` | `"auto"` or 1.0–2.0 | `"auto"` keeps the head the same size when the speaker walks; use 1.0 for wide shots with a replaced background |
| `push` | number | slow zoom per second (0 to disable; use 0 when the background is replaced) |
| `transition_in` | `cut` · `whip` · `flash` · `zoom_in` · `glitch` | whip after a graphic-heavy beat; flash into/out of a new world; glitch for "back to normal" |
| `captions`, `voice` | bool | turn off for rewind / silent beats |

## Captions (`captions[]`)
2–5 words per chunk, cut at natural phrase boundaries, `emph` = 1–2 key words that exist in the text.
`static: true` = on-screen text nobody speaks (from the creator's description): drawn without the word-by-word highlight.
Captions sit in a band at y≈1270–1480. Keep graphics out of that band while captions show.

## Graphics (`graphics[]`), each has `type` + `t0`/`t1` (or `role`/`at`/`dur`)
| type | params | when to use |
|---|---|---|
| `kinetic_text` | `lines:[{text,size,color}]`, `y` | hook in the first seconds, open loop before a payoff («حالا ببین...»), a key phrase |
| `speech_bubble` | `text, x, y` | greetings, short exclamations next to the head |
| `stamp` | `text, sub, x, y, angle` | labels like «نسخه تستی», «رایگان», «جدید»; pair with a `shakes` entry |
| `app_card` | `title, subtitle, rows[], row_times[], y` | introducing a product/service and its features |
| `ring_counter` | `x, y, label, fill, to` | completeness, percentages, progress (`fill` = seconds to fill, `to` = final share 0–1) |
| `viewfinder` | `label` | the speaker mentions recording / raw footage (uses the ungraded look) |
| `no_human` | `x, y, slash_at, label, label_x, label_y` | "without a person / no human involved" |
| `nle_timeline` | `y, work` | "editing", "processing", "it's being made" |
| `burst` | `text, x, y` | an exclamation word: «افکت!», «وای!» |
| `warning_sign` | `x, y, label` | danger / surprise / "watch out" |
| `pill` | `text, bg, icon(check/dot), x, y, size` | small labels, CTA question at the end |
| `live_voice` | `text, x, y` | "right now", "live", "as I'm talking"; bars follow the real voice |
| `vhs_rewind` | `text` (role `rewind`) | going back in time / returning to the start |

Safe zones: top band y 60–520 for most graphics; side zones x<300 or x>780 next to the head;
never over the face. Text auto-shrinks to 960px width.

## Effects (`effects[]`)
| type | params | use |
|---|---|---|
| `jungle` | `t0, t1` | speaker asks to be in a forest/jungle/nature; replaces the background |
| `sun` | `t0, t1, x, y, r` | sun in the sky (only drawn while `jungle` is active) |
| `dinosaur_walk` | `t0, t1, scale, feet_y, palette(brown), direction` | a big creature passing behind the speaker |
| `sky_fly` | `t0, t1` | flying / rising / "in the sky" |

## Audio
`audio.voice_chain`: ffmpeg filters for the voice. Use `"anull"` when nobody speaks (keeps music / ambience as recorded).
A source without a sound track is handled as silence.

## Creator brief (input, v0.2)
- `pov`: the angle of the video. Use it to choose what to emphasise and illustrate.
- `description`: what happens on screen. When nobody speaks, turn it into `static` captions.
- `options`: ids the creator picked in the panel (same ids as the graphic / effect / transition types, plus
  `zoom_punch`, `shake`, `cold_open`, `rewind`). Each must appear at least once; tag the element with `_opt: id`.
- `clips`: boundaries when several uploads were joined. Never let a caption cross one; put a transition on each.

## Sound (`sfx[]`)
`pop` (graphic appears) · `whoosh` · `swish` · `stamp` · `click` · `ding` (done/success) · `beep` (live/REC) ·
`shutter` (camera) · `ticks` (`dur`, typing/processing) · `riser` (`dur`, tension before a payoff) ·
`rise` (`dur`) · `impact` (hook, reveal) · `thuds` (`t0,t1,every`, footsteps + screen shake) ·
`birds` (`t0,t1`, jungle ambience) · `glitch` · `rewind` (role `rewind`).
Transitions add their own whoosh/swish/glitch automatically.

## Editorial rules learned from tests 1–2
1. Hook in the first 1.5s: a `cold_open` of the most visual moment + 2-line `kinetic_text`.
2. Something changes on screen at least every ~3s (graphic, zoom punch, cut, transition).
3. Visualise concrete phrases; leave 1–2s of breathing room between graphic-heavy beats.
4. An open loop (`kinetic_text` «حالا ببین...» + `riser`) right before the payoff.
5. Effects start exactly on the word that names them («جنگل», «خورشید», «دایناسور»).
6. End with a specific, experience-based CTA question (not «نظرتون چیه؟»).
7. Only use words the speaker confirmed; never invent effects the speech doesn't ask for.
