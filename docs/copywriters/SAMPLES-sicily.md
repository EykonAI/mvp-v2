# Register samples · one real event, three channels, three registers

**The event** (production, `newsjack_events` id `1e43282e`, drafted 2026-08-27, framing LIVE):
FIRMS shows a sharp thermal spike at ISAB sito sud — 36.8 MW FRP on Aug 21 and Aug 26,
against routine flare-level hits elsewhere on-site — while Black Marble logs a 3.1σ
radiance surge at San Filippo del Mela on Aug 16, +83% against its 21-night baseline.
Two independent sensors, concurrent, not-yet-confirmed operational stress on Sicily's
largest refinery-power complex; historically a precursor of an unplanned unit restart
or a flaring event, watched for Med diesel and product-margin volatility. Not a
confirmed outage.

Replay: `https://eykon.ai/c/aec9590e-bdf2-456e-a5b0-cb773ed3f5bc`
(each channel appends its own tag: `?utm_source=reddit&utm_medium=community&utm_campaign=newsjack`,
`?utm_source=discord&utm_medium=community&utm_campaign=newsjack`; TikTok carries no
clickable link — spoken/on-screen path `eykon.ai/start/tiktok`.)

No harm needles in the evidence, so the registers genuinely differ. One event on
purpose: register is the only variable.

---

## REDDIT — target r/OSINT (PROPOSED — rules unread, see allowlist)

### FLAT

**Title:** Two independent satellite sensors flag concurrent anomalies at Sicily's largest refinery-power complex

**Body:**

NASA FIRMS recorded a thermal detection of 36.8 MW fire radiative power at ISAB sito
sud on 21 and 26 August. Other detections on the same site over the period sit at
routine flare level. A working refinery flares as baseline behaviour, so the signal
here is deviation from the site's own norm, not the presence of heat.

Independently, NASA Black Marble (VIIRS VNP46A2, moonlight- and atmosphere-corrected
night-time radiance) logged San Filippo del Mela at 3.1σ above its 21-night baseline
on 16 August, an 83% excess. Readings are gated on confidently-clear nights only;
cloud-contaminated pixels are excluded rather than corrected.

The two instruments measure different physics — mid-infrared radiant heat and visible
emitted light — and fail independently. Both moving at the same complex in the same
window is a pattern that historically precedes an unplanned unit restart or a flaring
event.

What this does not establish: no outage is confirmed, no cause is identified, and a
hot pixel is not a fire. Ground truth or a further clear-night pass would resolve it;
neither exists yet.

Disclosure: I built eYKON, the platform that produced this detection. The live view,
with both sensor series: https://eykon.ai/c/aec9590e-bdf2-456e-a5b0-cb773ed3f5bc?utm_source=reddit&utm_medium=community&utm_campaign=newsjack

### DRY

**Title:** Sicily's largest refinery tripped two independent satellite sensors in the same week. Neither confirms anything yet.

**Body:**

ISAB sito sud flares every day. That is what refineries do, and it is why a raw heat
detection there means nothing. What FIRMS logged on 21 and 26 August is different in
degree: 36.8 MW of fire radiative power, against a site whose other hits that week sit
at routine flare level.

Ten days earlier and forty kilometres north, a different instrument saw a different
thing. Black Marble — night-time radiance, not heat — put San Filippo del Mela 83%
above its own 21-night baseline on 16 August. 3.1σ, on a confidently-clear night.

Mid-infrared and visible light. Two sensors, two physical quantities, one complex.
Each alone is a curiosity. Concurrent, they match the pattern that has historically
preceded an unplanned unit restart or a flaring event — the kind that shows up later
in Med diesel margins.

The honest caveat, stated in full: nothing is confirmed. No outage, no cause, no
ground truth. A hot pixel is not a fire and radiance is not operational state. This
is a watch item, not a finding.

Disclosure: I built eYKON, which produced this. Both series, live:
https://eykon.ai/c/aec9590e-bdf2-456e-a5b0-cb773ed3f5bc?utm_source=reddit&utm_medium=community&utm_campaign=newsjack

If anyone has local reporting on Priolo or Milazzo operations this month, that would
settle it faster than the next satellite pass.

### OPEN

**Title:** One sensor sees heat. A different sensor sees light. This week both pointed at the same Sicilian refinery complex.

**Body:**

Start with what makes this hard. A refinery is the worst possible place to detect an
anomaly by satellite: it burns things on purpose, all day, as baseline behaviour. Any
instrument that fires on "heat at a refinery" is useless.

So eYKON measures deviation from each site's own norm. On that measure, two
independent instruments moved this week.

FIRMS (mid-infrared, radiant heat): 36.8 MW FRP at ISAB sito sud on 21 and 26 August.
The site's other detections that week are routine flare level. Black Marble (visible
night-time radiance, clear-night gated): San Filippo del Mela at +83% against its
21-night baseline on 16 August — 3.1σ.

Different physics. Different failure modes. Same complex, same window.

Historically this concurrence precedes one of two mundane things — an unplanned unit
restart, or a flaring event — and either would matter for Med diesel margins before
it made any news wire.

Nothing is confirmed. No outage, no cause, no ground truth, and absence of
confirmation is stated here as a feature of the analysis, not a gap in it.

Disclosure: I built eYKON, which produced this detection. The live view:
https://eykon.ai/c/aec9590e-bdf2-456e-a5b0-cb773ed3f5bc?utm_source=reddit&utm_medium=community&utm_campaign=newsjack

Local knowledge of Priolo/Milazzo operations this month beats the next pass. If you
have it, I am wrong or right faster.

---

## DISCORD — one message + one embed

### FLAT

**Message:**
Two independent sensors flag concurrent anomalies at Sicily's largest refinery-power
complex. FIRMS: 36.8 MW FRP at ISAB sito sud, 21 and 26 Aug. Black Marble: San Filippo
del Mela +83% vs 21-night baseline, 16 Aug. Not a confirmed outage.
https://eykon.ai/c/aec9590e-bdf2-456e-a5b0-cb773ed3f5bc?utm_source=discord&utm_medium=community&utm_campaign=newsjack

**Embed** — title: `ISAB + San Filippo del Mela · cross-sensor anomaly, unconfirmed`
- **Thermal (FIRMS)** — 36.8 MW FRP at ISAB sito sud on Aug 21 and 26; other on-site hits at routine flare level.
- **Radiance (Black Marble)** — San Filippo del Mela 3.1σ / +83% vs its 21-night baseline, Aug 16, confidently-clear night.
- **Why it matters** — independent physics (mid-IR heat, visible light) moving concurrently at one complex; historical precursor of unit restart or flaring; Med diesel margin watch.
- **What this does not establish** — no confirmed outage, no cause, no ground truth. A hot pixel is not a fire; radiance is not operational state.

Footer: `FIRMS + Black Marble VNP46A2 · obs 2026-08-16 → 08-26 UTC · fetched 2026-08-27`

### DRY

**Message:**
A refinery that flares every day tripped the thermal sensor anyway — 36.8 MW FRP at
ISAB sito sud, twice this week, against a routine-flare baseline. Ten days earlier a
different instrument put the power plant next door 83% over its own light baseline.
Two sensors, two physical quantities, one complex, nothing confirmed. That last part
is the point.
https://eykon.ai/c/aec9590e-bdf2-456e-a5b0-cb773ed3f5bc?utm_source=discord&utm_medium=community&utm_campaign=newsjack

**Embed** — as FLAT, with the last field renamed **The honest read** — "a watch item,
not a finding. The next clear-night pass or local ground truth settles it."

Footer: as FLAT.

### OPEN

**Message:**
One sensor sees heat. One sees light. Both moved at Sicily's largest refinery complex
this week — ISAB sito sud at 36.8 MW FRP on the thermal band, San Filippo del Mela at
+83% over baseline on night-time radiance. Independent physics, same window.
Historically that concurrence precedes a unit restart or a flaring event, and either
moves Med diesel margins before it makes a wire. Unconfirmed, and stated as such.
https://eykon.ai/c/aec9590e-bdf2-456e-a5b0-cb773ed3f5bc?utm_source=discord&utm_medium=community&utm_campaign=newsjack

**Embed** — as FLAT.

---

## TIKTOK — script package (shots are real eYKON screens only)

### FLAT

- **hook** (≤90, spoken + on-screen): "Two satellite sensors flagged the same Sicilian refinery this week. Here is what they saw."
- **beats** (on-screen line ≤5 words · spoken · SHOT):
  1. `HEAT: 36.8 MW` · "The thermal sensor logged thirty-six point eight megawatts at ISAB — twice this week, against a routine flare baseline." · GLOBE, thermal layer, Sicily.
  2. `LIGHT: +83%` · "A different sensor saw the power plant next door at eighty-three percent over its normal light output." · GLOBE, night-lights layer, Sicily.
  3. `TWO SENSORS, ONE COMPLEX` · "Heat and light are measured independently. Both moving at once is the signal." · /c convergence page, both series visible.
  4. `NOT CONFIRMED` (limitBeat) · "A hot pixel is not a fire. Radiance is not operational state. Nothing here is a confirmed outage." · /c page, evidence panel.
  5. `WATCH IT RESOLVE` · "The next clear-night pass settles it. Track it live at eykon dot ai slash start slash tiktok." · /start page.
- **voiceover** (~70 words): the five spoken lines above, read plainly.
- **sound**: spoken voiceover, no trending audio. Burned-in subtitles, two lines max, 3–5 words per line.
- **caption** (front-loaded): "Satellite anomaly at Sicily's largest refinery complex: two independent sensors — thermal and night-lights — moved in the same week. 36.8 MW FRP at ISAB; +83% over baseline at San Filippo del Mela. Not a confirmed outage, and we say so. Sources: NASA FIRMS, NASA Black Marble. eykon.ai/start/tiktok"
- **hashtags**: #OSINT #satellite #energy
- **lockup**: lower third throughout — `eYKON · FIRMS + Black Marble · 2026-08-16→26 UTC · LIVE`; end card — `eykon.ai/start/tiktok`, nothing else.

### DRY

As FLAT, with:
- **hook**: "Sicily's largest refinery runs hot and bright. The interesting part is what is not confirmed."
- beat 3 spoken: "Refineries burn things on purpose, so heat alone means nothing. Deviation from the site's own baseline — on two instruments at once — is the rare part."
- beat 4 spoken: "And still: nothing is confirmed. That sentence is the product."

### OPEN

As FLAT, with:
- **hook**: "One satellite sees heat. Another sees light. This week both pointed at the same refinery."
- beat order: 3 → 1 → 2 → 4 → 5 (the independence claim opens; the numbers pay it off).
- beat 5 spoken: "Two sensors agreeing is a lead. Ground truth is a finding. Watch which one this becomes — eykon dot ai slash start slash tiktok."
