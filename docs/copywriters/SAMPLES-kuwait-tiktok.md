# The Kuwait detection as a TikTok script — the §9.5 test

The strongest 30 seconds the platform owns: on 2026-08-01 the night-lights sensor
detected a real power outage in Kuwait from orbit, with no news input, and the founder
confirmed it independently. Three neighbouring facilities, three confidently-clear
nights, one monotonic collapse in emitted light. It is already the opening screen of
/start.

Measured radiance (nW·cm⁻²·sr⁻¹): Az Zour South baseline ~97 → 7.2 / 5.5 / 4.7 over
Jul 21–23. Az Zour North ~46 → 5.4 / 4.6 / 3.4. Mina Al Ahmadi refinery ~104 → 16.7
on Jul 21. FIRMS then logged an `elevated` at Az Zour North on Jul 24 — heat up just
after light down, a plausible signature of a switch to backup or flaring. Suggestive,
not established.

If this script does not read as compelling, no script from this pipeline will, and
the record-or-not decision answers itself.

All shots are real screens: the /start radiance table, the GLOBE night-lights layer
over Kuwait, the GLOBE thermal layer.

---

### FLAT

- **hook**: "Three Kuwaiti power facilities went dark on satellite. No news reported it. It was real."
- **beats**:
  1. `BASELINE 97 → 4.7` · "Az Zour South normally reads ninety-seven units of emitted light. Over three nights it fell to seven, then five, then four." · /start Kuwait table.
  2. `THREE PLANTS, SAME NIGHTS` · "Az Zour North and the Mina Al Ahmadi refinery collapsed on the same nights. Three facilities, one region." · GLOBE night-lights, Kuwait.
  3. `CLEAR NIGHTS ONLY` (limitBeat) · "Every reading is from a confidently-clear night. Cloud can fake darkness, so cloudy pixels are thrown away, not corrected." · /c or /start method panel.
  4. `THEN HEAT` · "One day after the light died, the thermal sensor logged elevated burning at Az Zour North. Consistent with backup generation. Not established." · GLOBE thermal layer, Kuwait.
  5. `CONFIRMED REAL` · "The outage was independently confirmed. The satellite knew first. Watch the next one at eykon dot ai slash start slash tiktok." · /start.
- **voiceover** (~75 words): the spoken lines, read plainly.
- **sound**: spoken voiceover only. Burned-in subtitles, two lines max.
- **caption**: "A real power outage, detected from orbit before any news reported it. Three Kuwaiti facilities, three clear nights, one monotonic collapse in emitted light — then a thermal spike consistent with backup generation. Independently confirmed. Sources: NASA Black Marble, NASA FIRMS. eykon.ai/start/tiktok"
- **hashtags**: #OSINT #satellite #Kuwait
- **lockup**: lower third — `eYKON · NASA Black Marble · 2026-07-21→23 UTC · CONFIRMED`; end card — `eykon.ai/start/tiktok`.

### DRY

As FLAT, with:
- **hook**: "The lights went out in Kuwait three nights running. The only witness was five hundred miles up."
- beat 1 spoken: "Ninety-seven. Then seven. Then five. Then four. A power plant's light curve, on consecutive clear nights."
- beat 5 spoken: "No news input, one confirmation, and the satellite had it first. The next one is watchable live."

### OPEN

As FLAT, with:
- **hook**: "A power plant's baseline is 97. Then 7. Then 5. Then 4. Three plants. Three clear nights."
- beat order: 1 → 2 → 4 → 3 → 5 (the collapse opens cold; method arrives after the pattern).
- beat 3 spoken: "Before you trust it, know the method. Clear nights only. Cloud fakes darkness, so cloud is discarded — which is exactly why three clear-night collapses in a row mean something."
