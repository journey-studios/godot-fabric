// Counters the native validation reads through Runtime.evaluate; React reports
// every mount, cleanup and render here, so lifecycle claims are observed, not assumed.
export interface LibrariesStats {
  appMounts: number;
  appCleanups: number;
  renders: number;
  subtreeMounts: number;
  subtreeCleanups: number;
  presses: number;
  errors: string[];
}

declare global {
  var LibrariesStats: LibrariesStats;
}

export const stats: LibrariesStats = {
  appMounts: 0,
  appCleanups: 0,
  renders: 0,
  subtreeMounts: 0,
  subtreeCleanups: 0,
  presses: 0,
  errors: [],
};
globalThis.LibrariesStats = stats;
