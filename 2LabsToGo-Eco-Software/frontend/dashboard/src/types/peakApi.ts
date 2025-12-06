/**
 * Types for Peak Detection API Request and Response
 */

export type ChannelName = 'red' | 'green' | 'blue' | 'grayscale';

// Single peak info returned by API
export interface ApiPeakInfo {
  peak_height: number;
  peak_x: number;
  start_end: [number, number]; // [start_index, end_index]
  area: number;
}

// Peaks for a single channel, keyed by peak_x as string
export type ChannelPeaks = {
  [peakX: string]: ApiPeakInfo;
};

// Peaks for a single track, keyed by channel name
export type TrackPeaks = {
  [channel in ChannelName]?: ChannelPeaks;
};

// Full API response: keyed by track number as string
export type PeakDetectionApiResponse = {
  [trackIndex: string]: TrackPeaks;
};

// Single area change request for API
export interface ChangeAreaItem {
  band_key: string;
  channel_name: string;
  peak_index: number;
  new_start: number;
  new_end: number;
}

// Request body for peak detection API
export interface PeakDetectionApiParams {
  min_peak_height: number | null;
  peak_threshold: number | null;
  distance_bw_peaks: number | null;
  peak_prominence: number | null;
  peak_width: number | null;
  peak_wlen: number | null;
  peak_el_height: number | null;
  peak_plateau_size: number | null;
  peak_Min_peak_area: number | null;
  find_area: boolean;
  change_area: ChangeAreaItem[];
}

export interface PeakDetectionApiRequest {
  params: PeakDetectionApiParams;
  processed_data: {
    [trackIndex: string]: {
      [channel in ChannelName]?: number[];
    };
  };
}

// Transformed peak for use in chart components
export interface ChartPeak {
  x: number; // peak_x
  y: number; // peak_height
  startX: number; // start_end[0]
  endX: number; // start_end[1]
  area: number;
}

// Peaks organized per channel for a single track
export interface TrackChartPeaks {
  red: ChartPeak[];
  green: ChartPeak[];
  blue: ChartPeak[];
  grayscale: ChartPeak[];
}

// All tracks peaks for chart use
export type AllTracksChartPeaks = {
  [trackIndex: string]: TrackChartPeaks;
};

/**
 * Transform API response to chart-friendly format
 */
export function transformApiPeaksToChartPeaks(
  apiResponse: PeakDetectionApiResponse
): AllTracksChartPeaks {
  const result: AllTracksChartPeaks = {};

  for (const trackIndex in apiResponse) {
    const trackData = apiResponse[trackIndex];
    result[trackIndex] = {
      red: [],
      green: [],
      blue: [],
      grayscale: [],
    };

    for (const channel of ['red', 'green', 'blue', 'grayscale'] as ChannelName[]) {
      const channelPeaks = trackData[channel];
      if (!channelPeaks) continue;

      for (const peakXStr in channelPeaks) {
        const peakInfo = channelPeaks[peakXStr];
        result[trackIndex][channel].push({
          x: peakInfo.peak_x,
          y: peakInfo.peak_height,
          startX: peakInfo.start_end[0],
          endX: peakInfo.start_end[1],
          area: peakInfo.area,
        });
      }

      // Sort peaks by x position
      result[trackIndex][channel].sort((a, b) => a.x - b.x);
    }
  }

  return result;
}

/**
 * Get peaks for a specific track and channel
 */
export function getChannelPeaks(
  allPeaks: AllTracksChartPeaks,
  trackIndex: string | number,
  channel: ChannelName
): ChartPeak[] {
  return allPeaks[String(trackIndex)]?.[channel] ?? [];
}

/**
 * Find closest peak to a given x position
 */
export function findClosestPeak(
  peaks: ChartPeak[],
  targetX: number,
  tolerance: number = Infinity
): ChartPeak | null {
  if (!peaks || peaks.length === 0) return null;

  let closest: ChartPeak | null = null;
  let minDiff = Infinity;

  for (const peak of peaks) {
    const diff = Math.abs(peak.x - targetX);
    if (diff < minDiff && diff <= tolerance) {
      minDiff = diff;
      closest = peak;
    }
  }

  return closest;
}
