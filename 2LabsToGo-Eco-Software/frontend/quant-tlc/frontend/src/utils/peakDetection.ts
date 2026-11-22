export type DataPoint = {
  x: number;
  y: number;
  channel?: string;
  track?: number;
};
// type AllPeaks = {
//   redPeaks: DataPoint[];
//   greenPeaks: DataPoint[];
//   bluePeaks: DataPoint[];
//   grayPeaks: DataPoint[];
// };

type PeakPoint = { x: number; y: number };
export type ChannelName = "red" | "green" | "blue" | "grayscale";
type DetectedPeaks = {
  [trackIndex: number]: {
    [channel in ChannelName]: PeakPoint[];
  };
};

type SelectedPeak = {
  channel: ChannelName;
  band: number;
  peak: PeakPoint;
};

export interface PeakDetectionParams {
  minIncreasingSteps: number;
  minDecreasingSteps: number;
  minPeakHeight: number;
  hrfRange: [number, number];
}

type Channel = "red" | "green" | "blue" | "grayscale";

interface InputBand {
  red: DataPoint[];
  green: DataPoint[];
  blue: DataPoint[];
  grayscale: DataPoint[];
  image_url: string;
}

export type PeakBand = {
  red: { x: number; y: number }[];
  green: { x: number; y: number }[];
  blue: { x: number; y: number }[];
  grayscale: { x: number; y: number }[];
};

type AllPeaks = PeakBand[];

type TrackData = {
  trackIndex: number;
  data: Array<{
    hRF: number;
    red: number;
    green: number;
    blue: number;
    grayscale: number;
  }>;
};

type Input = TrackData[];

export type PeakData = {
  [trackName: string]: {
    [channelName: string]: DataPoint[];
  };
};
export function detectPeaks(
  data: DataPoint[],
  params: PeakDetectionParams
): DataPoint[] {
  const { minIncreasingSteps, minDecreasingSteps, minPeakHeight, hrfRange } =
    params;
  const peaks: DataPoint[] = [];
  console.log("--- detectPeaks called ---");
  console.log("Params:", {
    minIncreasingSteps,
    minDecreasingSteps,
    minPeakHeight,
    hrfRange,
  });
  // Filter data to hrfRange
  const filteredData = data.filter(
    (point) => point.x >= hrfRange[0] && point.x <= hrfRange[1]
  );
  console.log("Filtered data points:", filteredData.length, filteredData);

  for (let i = 0; i < filteredData.length; i++) {
    let isIncreasing = true;
    let isDecreasing = true;

    // Check increasing steps before i
    for (let j = 1; j <= minIncreasingSteps; j++) {
      if (i - j < 0 || filteredData[i - j + 1].y <= filteredData[i - j].y) {
        isIncreasing = false;
        break;
      }
    }

    // Check decreasing steps after i
    for (let j = 1; j <= minDecreasingSteps; j++) {
      if (
        i + j >= filteredData.length ||
        filteredData[i + j].y >= filteredData[i + j - 1].y
      ) {
        isDecreasing = false;
        break;
      }
    }

    // If peak
    if (isIncreasing && isDecreasing && filteredData[i].y >= minPeakHeight) {
      peaks.push(filteredData[i]);
      // console.log(
      //   `Selected peak at index ${i}:`,
      //   filteredData[i],
      //   "| isIncreasing:",
      //   isIncreasing,
      //   "| isDecreasing:",
      //   isDecreasing,
      //   "| y:",
      //   filteredData[i].y
      // );
    } else {
      // console.log(
      //   `Rejected point at index ${i}:`,
      //   filteredData[i],
      //   "| isIncreasing:",
      //   isIncreasing,
      //   "| isDecreasing:",
      //   isDecreasing,
      //   "| y:",
      //   filteredData[i].y
      // );
    }
  }

  console.log("Detected peaks:", peaks);
  return peaks;
}

// export function validatePeakSelection(
//   allPeaks: { [trackName: string]: PeakBand }, // updated type
//   selectedPeak: { x: number; y: number; channel: keyof PeakBand }, // channel is now limited to valid keys
//   tolerance: number = 100
// ): boolean {
//   const { x, channel } = selectedPeak;
//   let foundInTracks = 0;

//   for (const trackName in allPeaks) {
//     const channelPeaks = allPeaks[trackName][channel] || [];

//     const matchingPeak = channelPeaks.find(
//       (peak) => Math.abs(peak.x - x) <= tolerance
//     );

//     if (matchingPeak) {
//       foundInTracks++;
//     }
//   }

//   return foundInTracks > 1;
// }
export function validatePeakSelection(
  allPeaks: { [channel: string]: DataPoint[] },
  selectedPeak: { x: number; y: number; channel: string },
  tolerance: number = 5
): boolean {
  const { x } = selectedPeak;

  // Check that the peak exists in every channel (within tolerance)
  for (const channelName in allPeaks) {
    const peaksInChannel = allPeaks[channelName];

    const matchingPeak = peaksInChannel.find(
      (peak) => Math.abs(peak.x - x) <= tolerance
    );

    if (!matchingPeak) {
      // If not found in this channel, it's invalid
      return false;
    }
  }

  // Found in all channels
  return true;
}

export function processAllBands(
  inputData: Array<{
    hRF: number;
    red: number;
    green: number;
    blue: number;
    grayscale: number;
  }>,
  params: PeakDetectionParams
): PeakBand {
  const red = inputData.map((point) => ({ x: point.hRF, y: point.red }));
  const green = inputData.map((point) => ({ x: point.hRF, y: point.green }));
  const blue = inputData.map((point) => ({ x: point.hRF, y: point.blue }));
  const grayscale = inputData.map((point) => ({
    x: point.hRF,
    y: point.grayscale,
  }));

  console.log("---------------------");
  console.log(red, green, blue, grayscale);
  console.log(params);

  return {
    red: detectPeaks(red, params),
    green: detectPeaks(green, params),
    blue: detectPeaks(blue, params),
    grayscale: detectPeaks(grayscale, params),
  };
}

export function processAllTracksFromPreprocessed(
  allTracks: {
    [trackIndex: number]: {
      red: number[];
      green: number[];
      blue: number[];
      grayscale: number[];
    };
  },
  params: PeakDetectionParams
): {
  [trackIndex: number]: PeakBand;
} {
  const result: { [trackIndex: number]: PeakBand } = {};

  for (const trackIndex in allTracks) {
    const track = allTracks[trackIndex];

    const red = track.red.map((y, x) => ({ x, y }));
    const green = track.green.map((y, x) => ({ x, y }));
    const blue = track.blue.map((y, x) => ({ x, y }));
    const grayscale = track.grayscale.map((y, x) => ({ x, y }));

    result[+trackIndex] = {
      red: detectPeaks(red, params),
      green: detectPeaks(green, params),
      blue: detectPeaks(blue, params),
      grayscale: detectPeaks(grayscale, params),
    };
  }

  return result;
}

// ...existing code...
export function isPeakInAllTracks(
  allPeaks: DetectedPeaks,
  selectedPeak: SelectedPeak,
  threshold = 500
): SelectedPeak[] | false {
  const { channel, peak } = selectedPeak;
  const targetX = peak?.x;
  console.log("%%%%%%%%%%%%%%%%%%%%%");

  console.log("selectedPeak in fnnnn", selectedPeak);
  console.log("threshold", threshold);
  console.log("allpeaks", allPeaks);

  console.log("%%%%%%%%%%%%%%%%%%%%%");

  if (
    !Number.isFinite(targetX) ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    console.warn("[isPeakInAllTracks] Invalid targetX or threshold", {
      targetX,
      threshold,
    });
    return false;
  }

  const matchedPeaks: SelectedPeak[] = [];

  for (const [trackIndexStr, peaksByChannel] of Object.entries(allPeaks)) {
    const trackIndex = Number(trackIndexStr);
    const peaksInChannel = Array.isArray(peaksByChannel?.[channel])
      ? peaksByChannel[channel].filter(
          (p): p is PeakPoint =>
            p && Number.isFinite((p as any).x) && Number.isFinite((p as any).y)
        )
      : [];

    if (peaksInChannel.length === 0) {
      console.warn("[isPeakInAllTracks] No peaks in channel for track", {
        trackIndex,
        channel,
      });
      return false;
    }

    const match = peaksInChannel.find(
      (p) => Math.abs(p.x - targetX) <= threshold
    );

    if (!match) {
      const minDiff = Math.min(
        ...peaksInChannel.map((p) => Math.abs(p.x - targetX))
      );
      console.warn("[isPeakInAllTracks] No match within threshold", {
        trackIndex,
        channel,
        targetX,
        threshold,
        minDiff,
      });
      return false;
    }

    matchedPeaks.push({ channel, band: trackIndex, peak: match });
  }

  return matchedPeaks;
}
