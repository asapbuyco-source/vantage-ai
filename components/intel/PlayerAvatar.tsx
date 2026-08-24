import React, { useEffect, useState } from 'react';

// Lazy, once-per-session load of the player cutout photo map
// (TheSportsDB cutouts keyed by the same slug used as player_id).
let photosPromise: Promise<Record<string, string>> | null = null;

function loadPhotos(): Promise<Record<string, string>> {
  if (!photosPromise) {
    photosPromise = fetch('/player-photos.json')
      .then(r => r.json())
      .catch(() => ({}));
  }
  return photosPromise;
}

interface PlayerAvatarProps {
  playerId: string;
  name: string;
  size?: number;          // px
  className?: string;
  ringColor?: string;     // optional accent ring
}

/**
 * Player cutout photo with deterministic monogram fallback.
 * Photo map (~166KB) is fetched lazily on first use and cached module-level.
 */
export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  playerId,
  name,
  size = 40,
  className = '',
  ringColor,
}) => {
  const [photo, setPhoto] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!playerId) return;
    setPhoto(null);
    setFailed(false);
    loadPhotos().then(map => {
      if (!mounted) return;
      const url = map[playerId];
      if (url) setPhoto(url); else setFailed(true);
    }).catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; };
  }, [playerId]);

  const initials = (name || '?')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const style: React.CSSProperties = {
    width: size,
    height: size,
    ...(ringColor ? { boxShadow: `0 0 0 1.5px ${ringColor}55` } : {}),
  };

  if (photo && !failed) {
    return (
      <img
        src={photo}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`object-contain object-top bg-white/[0.04] rounded-full ${className}`}
        style={style}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-black shrink-0 ${className}`}
      style={{
        ...style,
        fontSize: size * 0.34,
        background: 'linear-gradient(135deg, rgba(34,211,238,0.18), rgba(168,85,247,0.18))',
        color: '#cbd5e1',
      }}
    >
      {initials}
    </div>
  );
};
