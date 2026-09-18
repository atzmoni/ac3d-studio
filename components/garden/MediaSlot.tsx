'use client';

/**
 * A place for a picture, at the size the picture has to be.
 *
 * The brief is to keep the template's layout now and drop the media in later,
 * so every image on this site goes through here. Without a `src` it draws a
 * leaf-tinted plate at the exact aspect ratio the final photo has to be, and
 * names what belongs there — so the page reads as finished furniture waiting
 * for its picture rather than as a broken image. Hand it a `src` and the same
 * box becomes the real thing, at the same size, with no layout shift.
 *
 * An `.mp4` becomes a silent looping clip instead of a still. Same box, same
 * crop, same rules — the only difference is that it moves.
 */
import { useEffect, useRef } from 'react';

export interface MediaSlotProps {
  /** Drop the finished photograph or clip in here — the box does not change shape. */
  src?: string;
  /**
   * A still that holds the box while a clip downloads, and that stands in for
   * the clip entirely when motion is unwelcome. Only means anything for a
   * video, and it has to be the clip's own first frame: anything else shows as
   * a jump the instant playback starts.
   */
  poster?: string;
  alt?: string;
  /** What this picture is meant to show, printed on the empty plate. */
  label: string;
  /** CSS aspect-ratio, e.g. '4 / 5'. */
  ratio?: string;
  /** Rounded like a pot, a pill, or square like the template's product tiles. */
  shape?: 'square' | 'soft' | 'round' | 'pill';
  /**
   * CSS object-position, for a picture whose subject is not in the middle.
   * These slots crop hard — a wide workshop shot squeezed into a tall box
   * loses its sides, and without this it is always the wrong sides.
   */
  focus?: string;
  className?: string;
  /** Hides the label text — for small decorative plates. */
  quiet?: boolean;
  /**
   * For the one picture that is above the fold. The browser's defaults are
   * built for media further down the page — fetch the bytes late, and only
   * after everything else. On the thing the visitor is looking at while the
   * page opens, that politeness is the whole delay.
   */
  priority?: boolean;
}

export default function MediaSlot({
  src, poster, alt, label, ratio = '4 / 3', shape = 'soft', focus,
  className = '', quiet = false, priority = false,
}: MediaSlotProps) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const node = video.current;
    if (!node) return;
    // The clip autoplays from the markup, because that is the one path
    // browsers optimise and the only one that reliably paints a frame. This
    // undoes it for somebody who has asked their system for less motion, and
    // parks the clip on frame zero — which is the poster, by the way the clip
    // is encoded, so what they get is simply the still.
    //
    // Listening rather than reading once is the point: the setting can change
    // while the page is open, and it is a setting about this moment.
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      if (query.matches) {
        node.pause();
        node.currentTime = 0;
      } else if (node.paused) {
        // Rejected when the browser will not autoplay at all; the poster stays
        // up, which is the same still, so there is nothing to recover from.
        void node.play().catch(() => undefined);
      }
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [src]);

  const classes = `media-slot media-${shape} ${src ? 'has-media' : ''} ${className}`.trim();
  const fit = focus ? { objectPosition: focus } : undefined;

  if (src && /\.(mp4|webm)$/i.test(src)) {
    return (
      <div className={classes} style={{ aspectRatio: ratio }}>
        <video
          ref={video}
          src={src}
          poster={poster}
          style={fit}
          autoPlay
          muted
          loop
          playsInline
          // `metadata` is right for a clip the visitor has to scroll to; for
          // the hero it means the box sits on its poster while the browser
          // decides the clip is worth having.
          preload={priority ? 'auto' : 'metadata'}
          aria-label={alt ?? label}
        />
      </div>
    );
  }

  if (src) {
    return (
      <div className={classes} style={{ aspectRatio: ratio }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt ?? label}
          style={fit}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
        />
      </div>
    );
  }

  return (
    <div className={classes} style={{ aspectRatio: ratio }} role="img" aria-label={`מקום שמור לתמונה: ${label}`}>
      <svg className="media-leaf" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M40 8C22 8 10 16 10 30c0 4 1 7 3 10 5-12 13-19 24-23-9 6-15 13-19 24 3 1 6 1 9 1 12 0 17-11 17-24 0-4-1-8-4-10Z" />
      </svg>
      {!quiet && <span className="media-label">{label}</span>}
    </div>
  );
}
