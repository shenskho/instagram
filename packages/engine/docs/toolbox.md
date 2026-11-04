# Director toolbox (v0.3)

This is the vocabulary the director may use in an edit plan. It is written to be pasted into the
director prompt in step 3. Screen space is 1080x1920. Times are SOURCE seconds, except elements
with `role`, whose `at`/`dur` count from the start of that timeline segment.

## Timeline segments (`timeline[]`)
| field | values | use |
|---|---|---|
| `src` | `[t0, t1]` | part of the raw video to show (cut pauses by leaving gaps) |
| `role` | none · `cold_open` · `rewind` · `replay` · `freeze` | `cold_open` = flash-forward of the payoff at 0s; `rewind` = replay a range backwards; `replay` = show a strong line again (zoom 1.3+); `freeze` = still frame |
| `hold` | seconds | with role `freeze`: hold the first frame of `src` (set `voice: false`, `captions: false`) |
| `reverse`, `speed` | bool, int | for `rewind` (speed 4 ≈ 0.7s for 3s of footage) |
| `zoom` | `"auto"` or 1.0–2.0 | `"auto"` keeps the head the same size when the speaker walks; use 1.0 for wide shots with a replaced background |
| `push` | number | slow zoom per second (0 to disable; use 0 when the background is replaced) |
| `transition_in` | `cut` · `whip` · `flash` · `zoom_in` · `zoom_out` · `glitch` · `spin` · `slide` · `dissolve` · `blur` · `circle` · `light_leak` | `dissolve`, `slide`, `circle` blend with the last frame of the previous segment; pick from the theme's family (below) |
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
| `kinetic_text` `anim` | `slam` · `pop` · `type` · `word` · `wave` | `type` types letter by letter |
| `speech_bubble` `shape` | `talk` · `think` · `shout` | |
| `stamp` `color` | `red` · `green` · `blue` · `black` | |
| `lower_third` | `name, subtitle, look(bar/card/minimal), y≈1660` | introduce the speaker (below the caption band) |
| `list_card` | `kind(checklist/steps/pros_cons), title, items[], row_times[], y` | lists; `-item` = a con in `pros_cons` |
| `compare` | `kind(before_after/versus/right_wrong), right, left, y` | two things side by side (right = first in RTL) |
| `count_up` · `bar_chart` · `progress` | `value, label, y` | numbers, growth, progress |
| `notification` | `kind(message/email/follow/payment/reminder), text, y≈190` | phone banner from the top |
| `chat` | `lines[], y` | alternating chat bubbles |
| `search_bar` | `query, y` | typed search |
| `timer` | `kind(countdown/stopwatch), seconds, x, y` | |
| `callout` | `kind(arrow/circle/scribble), color, label` | drawn at the speaker's head (engine knows where it is) |
| `emoji_pop` · `emoji_rain` | `emojis[]` (fire, laugh, shock, heart, like, hundred, eyes, party, idea, star, money, clap) | |
| `prohibit` | `icon(person/phone/money/clock/sugar), label, x, y, slash_at` | "no …" |
| `cta` | `kind(follow/like/save/share/comment), y, tap` | a finger taps the button at `tap` s |
| `quote` · `price_tag` · `location` | `text, author` · `price, old_price` · `place` | |
| `freeze_frame` | `frame(photo/comic/plain), label` (role `freeze`) | |
| `replay_badge` | `text` (role `replay`) | «دوباره ببین» |

Safe zones: top band y 60–520 for most graphics; side zones x<300 or x>780 next to the head;
never over the face. Text auto-shrinks to 960px width.

## Effects (`effects[]`)
| type | params | use |
|---|---|---|
| `scene` | `t0, t1, places[], change(fade/flash/wipe/glitch/cut), motion(drift/sway/still), style?` | replaces the background; `places` are shown in order, each a part of the window. A place is `{kind:"drawn", id}` (jungle, beach, space, city_night, desert, snow, underwater, sky, sunset), `{kind:"image"\|"video", path}` (relative to the plan), or from the director `{kind:"gen", text, style}` / `{kind:"upload", file}` (the worker turns these into image/video paths). `style` = a look for the background only |
| `sun` | `t0, t1, x, y, r` | sun in the sky of a jungle scene |
| `sky_fly` | `t0, t1, time(day/sunset/night)` | flying / rising / "in the sky" |
| `flyover` | `t0, t1, object(dinosaur/rocket/ufo/plane/birds/balloon), direction(rtl/ltr), size(big/small)` | something big passes behind the speaker |
| `particles` | `t0, t1, kind(confetti/snow/rain/hearts/stars/sparkles/embers/bubbles/leaves/money), layer(front/behind), amount(few/normal/many)` | |
| `focus` | `t0, t1, mode(blur/bw/dark/color), color` | the background steps back so the speaker stands out |
| `glow` | `t0, t1, mode(glow/sticker/outline), color(yellow/white/cyan/pink/rainbow)` | light or a sticker edge around the speaker |
| `clones` | `t0, t1, mode(side/mirror), count(2/3)` | copies of the speaker |
v0.2 names still work: `jungle` = a drawn jungle `scene`, `dinosaur_walk` = `flyover` dinosaur.

## Camera
`zoom.punches[]` (`t, mul, ease`), `shakes[]` (`t, amp, dur`), `tilts[]` (`t, angle, dur`: a short dutch angle),
slow zoom = a segment's `zoom` + `push` (negative `push` from `zoom` > 1 pulls out).

## One theme for the whole video
- `look`: `{style, scope}`. style = natural · cinematic · warm · cool · vivid · pastel · vintage · bw · cartoon · comic · anime ·
  sketch · color_pencil · watercolor · oil · pixel · neon. scope = whole · background · subject.
- `skin`: how graphics and captions are drawn (clean · retro · mono · cartoon · comic · sketch · paint · pixel · neon). Follows the look.
- `overlays`: grain · vhs · light_leak · bars · dust · vignette, over the whole video.
- `loop_end: true` blends the last 0.45s into the first frame.
Rule: a look picked for the whole video applies to the speaker, the background and every graphic. A drawn place is an
illustration, so picking one makes the whole video cartoon unless the creator keeps it to the background. Transitions the
director adds on its own come from the skin's family: clean → whip, zoom_in, slide, flash · cartoon → zoom_in, spin, circle, flash ·
comic → flash, circle, whip · sketch/paint → dissolve, blur, slide · pixel → glitch, slide · neon → glitch, flash, light_leak ·
retro → dissolve, light_leak, flash.

## Audio
`audio.voice_chain`: ffmpeg filters for the voice. Use `"anull"` when nobody speaks (keeps music / ambience as recorded).
A source without a sound track is handled as silence.

## Creator brief (input, v0.3)
- `pov`: the angle of the video. Use it to choose what to emphasise and illustrate.
- `description`: what happens on screen. When nobody speaks, turn it into `static` captions.
- `options`: `[{id, params}]` from the catalog in `packages/shared/src/catalog.ts` (option → type → details, e.g.
  `{id:"scene", params:{source:"drawn", places:["beach","space"], scope:"background"}}`). Each must appear at least once with
  the details asked for; tag the element with `_opt: id` (and `_label` for what exactly). Texts the creator typed are used as-is.
- `clips`: boundaries when several uploads were joined. Never let a caption cross one; put a transition on each.

## Sound (`sfx[]`)
`pop` (graphic appears) · `whoosh` · `swish` · `stamp` · `click` · `ding` (done/success) · `beep` (live/REC) ·
`shutter` (camera) · `ticks` (`dur`, typing/processing) · `riser` (`dur`, tension before a payoff) ·
`rise` (`dur`) · `impact` (hook, reveal) · `thuds` (`t0,t1,every`, footsteps + screen shake) ·
`birds` (`t0,t1`, jungle ambience) · `glitch` · `rewind` (role `rewind`) · `thud`.
Transitions add their own whoosh/swish/glitch automatically.

## Editorial rules learned from tests 1–2
1. Hook in the first 1.5s: a `cold_open` of the most visual moment + 2-line `kinetic_text`.
2. Something changes on screen at least every ~3s (graphic, zoom punch, cut, transition).
3. Visualise concrete phrases; leave 1–2s of breathing room between graphic-heavy beats.
4. An open loop (`kinetic_text` «حالا ببین...» + `riser`) right before the payoff.
5. Effects start exactly on the word that names them («جنگل», «خورشید», «دایناسور»).
6. End with a specific, experience-based CTA question (not «نظرتون چیه؟»).
7. Only use words the speaker confirmed; never invent effects the speech doesn't ask for.
