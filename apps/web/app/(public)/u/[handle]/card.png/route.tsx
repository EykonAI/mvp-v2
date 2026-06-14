import { ImageResponse } from 'next/og';
import { loadProfile } from '@/lib/comm/profile';
import { commProfilesEnabled } from '@/lib/flags';
import { personaLabel } from '@/lib/intelligence-analyst/personas';

// Server-side social card for a COMM profile — /u/<handle>/card.png.
// 1200×630 PNG for X / LinkedIn previews, mirroring the predictions
// card.png pattern. Phase 1 shows identity + a "calibrating" status
// (never a fabricated score); the verified skill score is wired in with
// the §9 engine.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const W = 1200;
const H = 630;
const BG = '#05080F';
const PANEL = '#15203A';
const INK = '#E8EDF5';
const DIM = '#98A3B5';
const TEAL = '#19D0B8';

export async function GET(_req: Request, ctx: { params: { handle: string } }) {
  if (!commProfilesEnabled()) return new Response('not found', { status: 404 });
  const data = await loadProfile(ctx.params.handle);
  if (!data) return new Response('not found', { status: 404 });

  const p = data.profile;
  const name = p.display_name || (p.handle ? `@${p.handle}` : 'Analyst');
  const sub = p.handle ? `@${p.handle}` : p.public_id ?? '';
  const persona = personaLabel(p.preferred_persona ?? 'analyst');

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          background: BG,
          color: INK,
          padding: 64,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 20,
            color: TEAL,
            letterSpacing: 4,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ display: 'flex' }}>eYKON · Calibration Passport</span>
          <span style={{ display: 'flex', color: DIM, letterSpacing: 2, fontSize: 16 }}>
            {persona}
          </span>
        </div>

        <div
          style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center' }}
        >
          <div style={{ display: 'flex', fontSize: 64, color: INK }}>{name}</div>
          <div style={{ display: 'flex', fontSize: 26, color: DIM, marginTop: 12 }}>
            {sub} · pseudonymous
          </div>
        </div>

        <div style={{ display: 'flex', gap: 64, paddingTop: 28, borderTop: `1px solid ${PANEL}` }}>
          <Stat label="Status" value={data.resolvedCount > 0 ? 'Calibrating' : 'New analyst'} />
          <Stat label="Resolved calls" value={String(data.resolvedCount)} />
          {p.is_founding_analyst && <Stat label="Role" value="Founding Analyst" tone />}
        </div>

        <div style={{ display: 'flex', marginTop: 24, fontSize: 16, color: DIM }}>
          <span style={{ display: 'flex' }}>Provable track record · eykon.ai</span>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        'Cache-Control':
          'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
      },
    },
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span
        style={{
          display: 'flex',
          fontSize: 15,
          color: DIM,
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', fontSize: 30, color: tone ? TEAL : INK }}>{value}</span>
    </div>
  );
}
