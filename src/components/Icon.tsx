// Hand-drawn-feeling, thin-stroke icon set. All icons inherit currentColor.
import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  home: 'M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z',
  library: 'M5 4h3v16H5zM10.5 4h3v16h-3zM16 5.2l2.9-.8 3.6 15.4-2.9.8z',
  echo: 'M12 20a8 8 0 1 1 8-8M12 16a4 4 0 1 1 4-4M12 12h.01',
  you: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  stop: 'M7 7h10v10H7z',
  check: 'M5 12.5 10 17.5 19.5 7',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  share: 'M12 15V4M8 8l4-4 4 4M6 12v8h12v-8',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5h.01',
  camera: 'M4 8h3.5L9 6h6l1.5 2H20v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  folder: 'M4 6h6l2 2h8v11H4z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13zM12 15v2.5',
  unlock: 'M7 11V8a5 5 0 0 1 9.6-2M5.5 11h13v9.5h-13zM12 15v2.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  refresh: 'M19 8a8 8 0 0 0-14.4 1M5 16a8 8 0 0 0 14.4-1M19 3v5h-5M5 21v-5h5',
  back10: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4M10 10v5M13 10h2.5v5H13z',
  fwd10: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4M9.5 10v5M12.5 10H15v5h-2.5z',
  next: 'M6 6l8 6-8 6zM17 6v12',
  shuffle: 'M4 7h3c5 0 5 10 10 10h3M17 14l3 3-3 3M4 17h3c1.6 0 2.7-1 3.6-2.4M13.4 9.4C14.3 8 15.4 7 17 7h3M17 4l3 3-3 3',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
  text: 'M5 6h14M5 11h14M5 16h9',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M6.3 17.7l2.4-2.4M15.3 8.7l2.4-2.4',
  envelope: 'M4 6h16v12H4zM4 7l8 6 8-6',
  fingerprint: 'M8 18c.8-1.8 1-3.6 1-6a3 3 0 0 1 6 0c0 2 0 4-.6 6M12 12c0 3-.4 5.6-1.6 8M5 15c.4-1 .6-2 .6-3a6.4 6.4 0 0 1 11-4.5M18.6 10c.3 3-.1 6-1 9',
  draft: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, ...rest }: { name: IconName | string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name] ?? ''} />
    </svg>
  );
}
