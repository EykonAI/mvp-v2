import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_URL } from '@/lib/url';
import { CLAUDE_TOOLS, CITIZEN_AI_TOOLS } from '@/lib/anthropic';
import { MCP_DAILY_LIMITS } from '@/lib/mcp/limits';

/**
 * /mcp — the public page a person lands on when they want to connect an
 * agent to eYKON. Deliberately a top-level public route, outside the
 * (app) group and not in middleware APP_PATHS, so it renders with no
 * login wall: someone evaluating whether to pay must be able to read
 * how it works first.
 *
 * The endpoint itself lives at /api/mcp. This page is the human half.
 *
 * Every number here is DERIVED from the same constants the server
 * enforces — the tool count from CLAUDE_TOOLS, the caps from
 * MCP_DAILY_LIMITS. The landing page has drifted on the tool count
 * twice already (#441 corrected 24 -> 23; a 24th tool then landed), so
 * nothing on this page is hand-typed.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect an agent — eYKON.ai',
  description:
    "Connect Claude, Cursor or your own agent to eYKON's live geopolitical-intelligence tools over the Model Context Protocol.",
  alternates: { canonical: `${APP_URL}/mcp` },
};

const PAID_TIERS = ['member', 'pro', 'desk', 'enterprise'] as const;

export default function McpPage() {
  const tools = CLAUDE_TOOLS;
  const citizenCount = tools.filter((t) => CITIZEN_AI_TOOLS.has(t.name)).length;

  return (
    <main className="mx-auto max-w-[820px] px-8 pb-32 pt-14 text-eykon-ink">
      <p className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-eykon-teal">
        ·· Model Context Protocol ··
      </p>
      <h1 className="mb-3 text-[36px] font-semibold leading-tight">Connect an agent</h1>
      <p className="mb-8 max-w-[62ch] text-[15px] leading-relaxed text-eykon-ink-dim">
        eYKON exposes {tools.length} live-data tools over MCP. Point Claude, Cursor or your own
        agent at the endpoint and it can query vessels, aircraft, conflict events, thermal
        anomalies, night-time radiance, convergence signals — and eYKON&apos;s own calibration
        record.
      </p>

      <section className="mb-9">
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-eykon-ink-dim">
          1 · Create a key
        </h2>
        <p className="mb-3 text-[14px] leading-relaxed text-eykon-ink-dim">
          Keys are created at{' '}
          <Link href="/settings" className="text-eykon-teal underline">
            Settings
          </Link>
          . The key is shown once and never again — eYKON stores only a hash of it.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-eykon-ink-dim">
          2 · Add the server
        </h2>
        <pre className="overflow-x-auto rounded border border-eykon-rule bg-eykon-bg-void px-4 py-3 font-mono text-[12.5px] leading-relaxed text-eykon-ink">
          {`claude mcp add --transport http eykon \\
  ${APP_URL}/api/mcp \\
  --header "Authorization: Bearer eyk_YOUR_KEY"`}
        </pre>
        <p className="mt-3 text-[13px] leading-relaxed text-eykon-ink-faint">
          Any MCP client works. The transport is stateless Streamable HTTP, so there is no session
          to manage and nothing to keep alive.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-eykon-ink-dim">
          Daily limits
        </h2>
        <table className="w-full border-collapse text-[14px]">
          <tbody>
            {PAID_TIERS.map((t) => (
              <tr key={t} className="border-b border-eykon-rule">
                <td className="py-2 capitalize text-eykon-ink-dim">{t}</td>
                <td className="py-2 text-right font-mono text-eykon-ink">
                  {MCP_DAILY_LIMITS[t]} calls/day
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[13px] leading-relaxed text-eykon-ink-faint">
          Limits reset at 00:00 UTC. MCP is included on paid plans; the free tier does not include
          it. A citizen-tier key reaches {citizenCount} of the {tools.length} tools and is refused
          on every call while its plan carries no allowance.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-eykon-ink-dim">
          What you get back
        </h2>
        <p className="mb-3 max-w-[62ch] text-[14px] leading-relaxed text-eykon-ink-dim">
          Every successful result carries a provenance envelope: the instrument behind the number,
          how well grounded it is, and its known limits. That is deliberate — a tool result travels
          into your agent&apos;s context with no eYKON page around it to caveat it, so the caveats
          travel with the data.
        </p>
        <p className="max-w-[62ch] text-[14px] leading-relaxed text-eykon-ink-dim">
          Several feeds are partial and say so. AIS is chokepoint-only. Night-lights lag NASA
          publication by about nine days. Thermal watches 10,556 of 13,262 facilities, and the
          uncovered regions return <span className="font-mono text-eykon-ink">NO DATA</span>, never
          zero. Critical minerals is fixture-backed and excluded from anything quotable.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-eykon-ink-dim">
          The {tools.length} tools
        </h2>
        <ul className="space-y-2">
          {tools.map((t) => (
            <li key={t.name} className="border-b border-eykon-rule pb-2">
              <code className="font-mono text-[13px] text-eykon-teal">{t.name}</code>
              <p className="mt-0.5 text-[13px] leading-relaxed text-eykon-ink-faint">
                {t.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-eykon-ink-dim">
          The one nobody else has
        </h2>
        <p className="max-w-[62ch] text-[14px] leading-relaxed text-eykon-ink-dim">
          <code className="font-mono text-eykon-teal">query_calibration</code> returns eYKON&apos;s
          own forecast record — Brier scores and skill by observable family, against each
          family&apos;s own base rate. Your agent can ask how well eYKON has actually performed on a
          question type before it trusts the answer. Forecasts are hash-bound at issue and the hash
          is publicly recomputable in the browser.
        </p>
      </section>
    </main>
  );
}
