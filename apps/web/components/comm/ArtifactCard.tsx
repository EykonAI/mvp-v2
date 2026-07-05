'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ArtifactRef, ArtifactPreview } from '@/lib/comm/embeds';

// Artifact card rendered under a room/Space message that references a
// public eYKON artifact (/c or /q page). While loading (or on any
// error) it renders nothing — the raw URL in the message body remains
// the fallback, so a failed preview degrades to exactly what the
// message looked like before this feature existed.
export function ArtifactCard({ artifactRef }: { artifactRef: ArtifactRef }) {
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/comm/artifact-preview?kind=${artifactRef.kind}&id=${artifactRef.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(p => {
        if (alive && p && !p.error) setPreview(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [artifactRef.kind, artifactRef.id]);

  if (!preview) return null;

  return (
    <div
      style={{
        marginTop: 8,
        border: '1px solid var(--rule)',
        borderLeft: '2px solid var(--teal)',
        borderRadius: 6,
        padding: '10px 12px',
        background: 'var(--bg-panel)',
        maxWidth: 480,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 4,
        }}
      >
        {preview.badge}
        {preview.createdAt ? ` · ${new Date(preview.createdAt).toISOString().slice(0, 10)}` : ''}
      </div>
      <Link href={preview.href} style={{ textDecoration: 'none' }} prefetch={false}>
        <div style={{ color: 'var(--ink)', fontSize: 13.5, fontWeight: 600 }}>{preview.title}</div>
        {preview.excerpt && (
          <p style={{ color: 'var(--ink-dim)', fontSize: 12, margin: '4px 0 0', lineHeight: 1.5 }}>
            {preview.excerpt}
          </p>
        )}
      </Link>
      {preview.cta && (
        <Link
          href={preview.cta.href}
          prefetch={false}
          style={{
            display: 'inline-block',
            marginTop: 8,
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            color: 'var(--teal)',
            textDecoration: 'none',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            padding: '4px 10px',
          }}
        >
          {preview.cta.label}
        </Link>
      )}
    </div>
  );
}
