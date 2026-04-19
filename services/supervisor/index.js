/**
 * eYKON.ai — Supervisor Agent
 * Autonomous monitoring loop: reads anomaly flags, evaluates watch conditions,
 * dispatches domain sub-agents, stores reports, triggers notifications.
 *
 * Runs as a standalone Railway service (Layer 1b).
 * Heartbeat: every 5 minutes.
 */

const Anthropic = require('@anthropic-ai/sdk');

const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Supabase REST helper ───
async function supabaseQuery(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });
  return res.json();
}

async function supabaseInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function supabaseUpdate(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return res.ok;
}

// ─── Domain Sub-Agent Definitions ───
const SUB_AGENTS = {
  maritime: {
    name: 'Maritime Intelligence Agent',
    system: `You are the eYKON Maritime Intelligence Sub-Agent. Analyse maritime anomalies: AIS gaps, unusual vessel behaviour, port congestion, dark-ship events. Return a structured JSON report with: title, severity (low/medium/high/critical), summary, narrative, entities array, sources array.`,
  },
  air_traffic: {
    name: 'Air Traffic Intelligence Agent',
    system: `You are the eYKON Air Traffic Intelligence Sub-Agent. Analyse aviation anomalies: military aircraft activity, unusual flight patterns, restricted airspace violations. Return a structured JSON report with: title, severity, summary, narrative, entities array, sources array.`,
  },
  conflict_security: {
    name: 'Conflict & Security Agent',
    system: `You are the eYKON Conflict & Security Sub-Agent. Analyse armed conflict patterns: escalation trends, actor movements, humanitarian impact. Return a structured JSON report with: title, severity, summary, narrative, entities array, sources array.`,
  },
  energy_infrastructure: {
    name: 'Energy Infrastructure Agent',
    system: `You are the eYKON Energy Infrastructure Sub-Agent. Analyse energy disruptions: pipeline outages, generation anomalies, cross-border flow changes. Return a structured JSON report with: title, severity, summary, narrative, entities array, sources array.`,
  },
  satellite_imagery: {
    name: 'Satellite & Imagery Agent',
    system: `You are the eYKON Satellite & Imagery Sub-Agent. Analyse satellite and observation data: weather anomalies, visibility conditions. Return a structured JSON report with: title, severity, summary, narrative, entities array, sources array.`,
  },
};

// ─── Dispatch a Sub-Agent ───
async function dispatchSubAgent(domain, taskPayload) {
  const agent = SUB_AGENTS[domain];
  if (!agent) return null;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: agent.system,
      messages: [{
        role: 'user',
        content: `Analyse this anomaly and produce an intelligence report:\n\n${JSON.stringify(taskPayload, null, 2)}`,
      }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Try to parse structured JSON from response
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}

    // Fallback: wrap text as report
    return {
      title: `${agent.name} Report`,
      severity: 'medium',
      summary: text.substring(0, 200),
      narrative: text,
      entities: [],
      sources: [taskPayload.source || domain],
    };
  } catch (err) {
    console.error(`Sub-agent ${domain} error:`, err.message);
    return null;
  }
}

// ─── Convergence synthesis (Opus 4.7) ───
async function synthesiseConvergences() {
  // Read convergence_events created in the last heartbeat window that have no synthesis yet.
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const rows = await supabaseQuery(
    'convergence_events',
    `created_at=gte.${encodeURIComponent(since)}&synthesis=is.null&limit=10`,
  );
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let written = 0;
  for (const row of rows) {
    try {
      const r = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 160,
        system:
          'You are the eYKON Supervisor. Write one short English sentence (≤ 35 words) describing what this cluster of anomalies means, in the voice of a senior analyst.',
        messages: [
          { role: 'user', content: JSON.stringify({ location: row.location, bbox: row.bounding_box, contributing: row.contributing_anomalies, p: row.joint_p_value }) },
        ],
      });
      const txt = r.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      if (txt) {
        await supabaseUpdate('convergence_events', row.id, { synthesis: txt });
        written++;
      }
    } catch (err) {
      console.error('synthesis error:', err.message);
    }
  }
  return written;
}

// ─── Precursor-match alerts ───
async function emitPrecursorAlerts() {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const scores = await supabaseQuery(
    'posture_scores',
    `computed_at=gte.${encodeURIComponent(since)}&precursor_similarity=gte.0.85&limit=20`,
  );
  if (!Array.isArray(scores)) return 0;
  let emitted = 0;
  for (const row of scores) {
    try {
      await supabaseInsert('notification_queue', {
        channel: 'in_app',
        title: `Precursor match · ${row.theatre_slug}`,
        body: `cosine ${Number(row.precursor_similarity).toFixed(2)} to ${row.precursor_match_id}`,
        payload: { type: 'precursor_match', theatre: row.theatre_slug, similarity: row.precursor_similarity, match_id: row.precursor_match_id },
        severity: 'critical',
      });
      emitted++;
    } catch {}
  }
  return emitted;
}

// ─── Supervisor Heartbeat ───
async function heartbeat() {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] Supervisor heartbeat`);

  try {
    // 1. Read unprocessed anomaly flags
    const flags = await supabaseQuery(
      'anomaly_flags',
      'processed=eq.false&order=created_at.desc&limit=50'
    );

    if (!Array.isArray(flags) || flags.length === 0) {
      await logExecution('supervisor', 'heartbeat', { flags_found: 0 }, Date.now() - start);
      return;
    }

    console.log(`  Found ${flags.length} unprocessed flags`);

    // 2. Get active user watchlists
    const watchlists = await supabaseQuery('watchlists', 'alert_enabled=eq.true');

    // 3. Process each flag
    for (const flag of flags) {
      // Check if any watchlist matches this flag's domain/region
      const matchingWatchlists = (watchlists || []).filter(w => {
        if (w.type === 'topic' && w.config?.keywords) {
          return w.config.keywords.some(k =>
            flag.flag_type?.toLowerCase().includes(k.toLowerCase()) ||
            flag.domain?.toLowerCase().includes(k.toLowerCase())
          );
        }
        if (w.type === 'region' && w.config?.bounding_box && flag.payload?.latitude) {
          const bb = w.config.bounding_box;
          return flag.payload.latitude >= bb.lat_min && flag.payload.latitude <= bb.lat_max &&
                 flag.payload.longitude >= bb.lon_min && flag.payload.longitude <= bb.lon_max;
        }
        return false;
      });

      // Dispatch sub-agent if severity >= medium OR matches a watchlist
      if (flag.severity !== 'low' || matchingWatchlists.length > 0) {
        console.log(`  Dispatching ${flag.domain} sub-agent for flag ${flag.id}`);
        const report = await dispatchSubAgent(flag.domain, flag.payload);

        if (report) {
          // Store report
          for (const wl of matchingWatchlists) {
            await supabaseInsert('agent_reports', {
              domain: flag.domain,
              severity: report.severity || flag.severity,
              title: report.title,
              summary: report.summary,
              narrative: report.narrative,
              entities: report.entities || [],
              sources: report.sources || [],
              bounding_box: flag.payload?.bounding_box,
              user_id: wl.user_id,
            });

            // Queue notification
            await supabaseInsert('notification_queue', {
              user_id: wl.user_id,
              channel: 'in_app',
              title: report.title,
              body: report.summary,
              payload: { report_id: report.id, domain: flag.domain },
            });
          }

          // Also store a global (no user) report
          if (matchingWatchlists.length === 0) {
            await supabaseInsert('agent_reports', {
              domain: flag.domain,
              severity: report.severity || flag.severity,
              title: report.title,
              summary: report.summary,
              narrative: report.narrative,
              entities: report.entities || [],
              sources: report.sources || [],
            });
          }
        }
      }

      // Mark flag as processed
      await supabaseUpdate('anomaly_flags', flag.id, { processed: true });
    }

    // Extended duties (Phase 7):
    //  1. Synthesise new convergence_events with Opus 4.7.
    //  2. Emit precursor-match alerts when cosine similarity ≥ 0.85.
    const synthesised = await synthesiseConvergences();
    const precursorAlerts = await emitPrecursorAlerts();

    await logExecution('supervisor', 'heartbeat', {
      flags_found: flags.length,
      watchlists_active: (watchlists || []).length,
      synthesised,
      precursor_alerts: precursorAlerts,
    }, Date.now() - start);

  } catch (err) {
    console.error('Supervisor error:', err.message);
    await logExecution('supervisor', 'error', { error: err.message }, Date.now() - start);
  }
}

async function logExecution(agentType, action, payload, durationMs) {
  try {
    await supabaseInsert('agent_execution_log', {
      agent_type: agentType,
      action,
      payload,
      duration_ms: durationMs,
    });
  } catch {}
}

// ─── Main Loop ───
async function main() {
  console.log('eYKON Supervisor Agent starting...');
  console.log(`  Heartbeat interval: ${HEARTBEAT_INTERVAL / 1000}s`);
  console.log(`  Supabase: ${SUPABASE_URL ? 'configured' : 'NOT configured'}`);
  console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT configured'}`);

  // Initial heartbeat
  await heartbeat();

  // Schedule recurring heartbeats
  setInterval(heartbeat, HEARTBEAT_INTERVAL);
}

main().catch(err => {
  console.error('Fatal supervisor error:', err);
  process.exit(1);
});
