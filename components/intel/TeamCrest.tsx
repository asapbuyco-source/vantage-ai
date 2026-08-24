import React, { useEffect, useState } from 'react';

// Lazy once-per-session load of club crest map (~96 clubs, football-data/Wikipedia SVGs)
let crestsPromise: Promise<Record<string, string>> | null = null;

function loadCrests(): Promise<Record<string, string>> {
  if (!crestsPromise) {
    crestsPromise = fetch('/team-logos.json')
      .then(r => r.json())
      .catch(() => ({}));
  }
  return crestsPromise;
}

const normalize = (name: string) =>
  (name || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

/** Resolve a crest URL for a club name (also tries the slug id). */
export function useTeamCrest(teamName?: string, teamId?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const key1 = normalize(teamName || '');
    const key2 = (teamId || '').toLowerCase().replace(/-/g, ' ').trim();
    if (!key1 && !key2) return;
    loadCrests().then(map => {
      if (!mounted) return;
      setUrl(map[key1] || map[key2] || null);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [teamName, teamId]);

  return url;
}

interface TeamCrestProps {
  teamName: string;
  teamId?: string;
  size?: number;
  className?: string;
}

/**
 * Club crest with deterministic monogram fallback.
 * Crest map lazy-fetched like PlayerAvatar photos.
 */
export const TeamCrest: React.FC<TeamCrestProps> = ({ teamName, teamId, size = 40, className = '' }) => {
  const url = useTeamCrest(teamName, teamId);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [url]);

  const initials = (teamName || '?')
    .split(' ')
    .map(w => w[0])
    .slice(0, 3)
    .join('')
    .toUpperCase();

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={teamName}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-xl flex items-center justify-center font-black shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.3,
        background: 'linear-gradient(135deg, rgba(34,211,238,0.15), rgba(168,85,247,0.15))',
        color: '#cbd5e1',
      }}
    >
      {initials}
    </div>
  );
};
