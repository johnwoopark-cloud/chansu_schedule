// Inline stroke icons so the app never fetches an icon font.

const PATHS = {
  today: 'M8 2v3M16 2v3M3.5 9h17M5 4.5h14A1.5 1.5 0 0 1 20.5 6v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5ZM8 14l2.5 2.5L16 12',
  medicines: 'M10.5 20.5 3.5 13.5a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7ZM7 10l7 7',
  prescriptions: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v5h5M9.5 13h6M9.5 17h4',
  analysis: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z',
  alert: 'M12 9v4M12 17h.01M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9ZM7.5 7.5h.01',
  pause: 'M9 5v14M15 5v14',
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  stop: 'M6 6h12v12H6Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  skip: 'M6 6l12 12M18 6 6 18',
  forward: 'M9 6l6 6-6 6',
  note: 'M5 4h14v12l-4 4H5ZM15 20v-4h4M8 9h8M8 13h5',
  // Medicine icons (MedicineIcon keys prefixed with "med-")
  'med-tablet': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.5 12h17',
  'med-capsule': 'M10.5 20.5 3.5 13.5a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7ZM7 10l7 7',
  'med-liquid': 'M9 3h6M10 3v3L7 9v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9l-3-3V3M7 13h10',
  'med-drop': 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z',
  'med-sachet': 'M5 4h14v16H5ZM5 8h14M9 13h6M9 16h4',
  'med-injection': 'M17 3l4 4M19 5l-3 3M16 8l-8.5 8.5-3-3L13 5ZM7.5 16.5 3 21M10 10l2 2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={name === 'more' ? 3 : 1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
