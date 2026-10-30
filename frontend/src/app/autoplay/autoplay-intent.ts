// Autoplay session length options. The tester's prompt is interpreted
// only by the AI agent (autoplay-agent.ts); there is no local parser.

/** Settings slider stops. ms null = Infinite. */
export const AUTOPLAY_DURATIONS: { label: string; ms: number | null }[] = [
  { label: '1 min', ms: 60_000 }, { label: '2 min', ms: 120_000 }, { label: '5 min', ms: 300_000 },
  { label: '10 min', ms: 600_000 }, { label: '15 min', ms: 900_000 }, { label: '30 min', ms: 1_800_000 },
  { label: '60 min', ms: 3_600_000 }, { label: 'Infinite', ms: null },
];
