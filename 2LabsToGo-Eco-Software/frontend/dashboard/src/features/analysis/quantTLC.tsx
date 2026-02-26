/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import IndividualLineChart from "@/components/charts/IndividualLineChart";
import D3InteractiveChart, { D3InteractiveChartHandle, PeakAreaChangeInfo, EditPeakIntegrationInfo, BatchAddPeaksInfo } from "@/components/charts/peak-linechart";
import * as d3 from "d3";
import ImageCropper from "@/components/Image/ImageCropper";
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from "@/lib/store";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import DensitogramGraph from "@/components/charts/DensitogramGraph";
import jsPDF from "jspdf";

import { AppDispatch } from "@/lib/store";
import { unwrapResult } from '@reduxjs/toolkit';
import { fetchBandData } from "@/features/api/extractBandApiSlice";

import {
  preprocessAllTracksAPI,
  PreprocessedOutput,
} from "@/utils/preprocessing";
import { detectPeaks, isPeakInAllTracks, PeakDetectionParams, processAllBands, processAllTracksFromPreprocessed, validatePeakSelection, DataPoint } from "@/utils/peakDetection";
import { ChannelName } from "@/utils/peakDetection"; 
import { Sriracha } from "next/font/google";
import {
  PeakDetectionApiResponse,
  PeakDetectionApiParams,
  AllTracksChartPeaks,
  ChartPeak,
  ChangeAreaItem,
  EditPeakIntegrationItem,
  transformApiPeaksToChartPeaks,
  getChannelPeaks,
} from "@/types/peakApi";
import { validateHeaderValue } from "http";
import CalibrationCurve from "@/components/charts/Calibration";
import { base64ToDataUrl } from "@/utils/cropImage";
import { apiUrl } from "@/utils/api";
// ...existing code...
import axios from "axios";
import { log } from "console";


import autoTable from "jspdf-autotable";

export const preprocessingOptions = [
  { label: "Peak Inversion", labelShort: "Peak Inversion", value: "NegativePeakInversion" },
  { label: "Baseline", labelShort: "Baseline", value: "baseline" },
  { label: "Smoothing", labelShort: "Smoothing", value: "smoothing" },
  { label: "Warping", labelShort: "Warping", value: "warping" },
] as const;

export type PreprocessValue = typeof preprocessingOptions[number]["value"];
const preprocessingLabelByValue: Record<PreprocessValue, string> =
  preprocessingOptions.reduce((acc, o) => {
    acc[o.value] = o.label;
    return acc;
  }, {} as Record<PreprocessValue, string>);

type HelpParam = { info: string; type?: string; constraint?: string; typical?: string };
type HelpEntry = {
  purpose: string;
  parameters?: Record<string, HelpParam>;
  constraints?: string[];
  reference_url?: string | string[];
};

const ADVANCED_PREPROCESS_HELP = {
  "Peak.Integration": {
    purpose:
      "Locates peaks using SciPy and calculates their area by integrating between slope-defined boundaries.",
    parameters: {
      distance: {
        type: "int",
        info: "Minimum horizontal distance (in samples) between neighboring peaks.",
        typical: "30",
      },
      height: {
        type: "float/array",
        info: "Minimum required height of peaks.",
      },
      prominence: {
        type: "float/array",
        info: "Minimum required prominence of peaks.",
      },
      width: {
        type: "float/array",
        info: "Minimum required width of peaks.",
      },
      rel_height: {
        type: "float",
        info: "Relative height at which the peak width is measured.",
        typical: "0.5",
      },
      Min_peak_area: {
        type: "float",
        info: "Threshold to filter out peaks with a calculated area smaller than this value.",
      },
      find_area: {
        type: "bool",
        info: "Enable/disable area calculation under each peak.",
      },
    },
    constraints: [
      "Peak detection relies on the SciPy find_peaks algorithm.",
      "Boundaries for integration are found by moving outward from the peak index until slope changes sign.",
      "Area is calculated using the trapezoidal rule (numpy.trapz).",
    ],
    reference_url: [
      "https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.find_peaks.html",
      "https://numpy.org/doc/1.25/reference/generated/numpy.trapz.html",
    ],
  } satisfies HelpEntry,

  "Calibration.Models": {
    purpose:
      "Select the model used to fit the calibration curve (standards vs response).\n\nModels:\n- hill: Hill Equation (https://en.wikipedia.org/wiki/Hill_equation_(biochemistry))\n- mm_origin: Michaelis–Menten Kinetics (https://en.wikipedia.org/wiki/Michaelis%E2%80%93Menten_kinetics)\n- mm_intercept: Michaelis–Menten Kinetics (https://en.wikipedia.org/wiki/Michaelis%E2%80%93Menten_kinetics)\n- linear: Simple Linear Regression (https://en.wikipedia.org/wiki/Simple_linear_regression)\n- linear_origin: Simple Linear Regression (https://en.wikipedia.org/wiki/Simple_linear_regression)\n- poly2: Polynomial Regression (https://en.wikipedia.org/wiki/Polynomial_regression)",
  } satisfies HelpEntry,

  Smoothing: {
    purpose:
      "Savitzky–Golay filter reduce noise while preserving peak shape; fits a local polynomial in a moving window (row-wise per channel).",
    parameters: {
      "window.size": {
        info: "larger = more smoothing; smaller = more detail",
        type: "int (odd)",
        constraint: "must be odd and > poly.order",
      },
      "poly.order": {
        info: "degree of local fit; higher tracks curvature, may overfit",
        type: "int",
      },
      "diff.order": {
        info: "derivatives amplify noise; use a larger window",
        type: "int",
      },
    },
    constraints: [
      "window.size must be odd and strictly greater than poly.order",
      "row length must be >= window.size",
    ],
    reference_url: "https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.savgol_filter.html",
  } satisfies HelpEntry,

  "Warping.PTW": {
    purpose:
      "Polynomial Time Warping aligns signals to a template via a polynomial time map (optionally per segment).",
    parameters: {
      ptw: {
        type: "int",
        info: "index of the template (reference band) used for alignment",
      },
      degree: {
        type: "int >= 1",
        typical: "1–3",
        info: "polynomial degree of the time mapping; higher = more flexible",
      },
      seg_len: {
        type: "int or null",
        typical: "None or 50–200",
        info: "segment length for piecewise warping; None uses whole signal",
      },
    },
    constraints: [
      "signals must be numeric and comparable to the template",
      "seg_len must be > 0 if provided",
      "effective degree per segment ≤ segment_length - 1",
    ],
    reference_url: [
      "https://cran.r-project.org/web/packages/ptw/index.html",
      "https://numpy.org/doc/stable/reference/generated/numpy.polynomial.polynomial.Polynomial.html",
    ],
  } satisfies HelpEntry,

  "Warping.DTW": {
    purpose:
      "Dynamic Time Warping elastically aligns sequences to a template by minimizing cumulative distance under a warping path.",
    parameters: {
      dtw: {
        type: "int",
        info: "index of the template (reference band) used for alignment",
      },
    },
    constraints: [
      "signals must be numeric and non-empty",
      "DTW can be slow for very long sequences; consider downsampling",
    ],
    reference_url: [
      "https://dtaidistance.readthedocs.io/en/latest/usage/dtw.html",
      "https://en.wikipedia.org/wiki/Dynamic_time_warping",
    ],
  } satisfies HelpEntry,

  "Baseline.ASLS": {
    purpose:
      "Asymmetric Least Squares (AsLS) smoothing for baseline estimation using Whittaker-style penalties to ignore peaks.",
    parameters: {
      lam: {
        type: "float/log",
        info: "Smoothness penalty (10^lam). Higher values result in a smoother baseline.",
      },
      p: {
        type: "float (0 to 1)",
        info: "Asymmetry parameter. Lower values (e.g., 0.01) keep the baseline below peaks.",
      },
      max_iter: {
        type: "int",
        info: "Maximum number of iterations for the algorithm to converge.",
      },
    },
    constraints: ["lam is converted from log scale internally: 10 ** lam"],
    reference_url:
      "https://pybaselines.readthedocs.io/en/latest/algorithms/whittaker.html#asls-asymmetric-least-squares",
  } satisfies HelpEntry,

  "Baseline.IRLS": {
    purpose:
      "Robust Iteratively Reweighted Least Squares for Whittaker-based baseline estimation, helpful for signals with high noise.",
    parameters: {
      lam: {
        type: "float/log",
        info: "Smoothness penalty (10^lam).",
      },
      wi: {
        type: "float",
        info: "Small weight assigned to points identified as peaks.",
      },
      diff_order: {
        type: "int",
        info: "Order of the finite difference penalty (typically 2).",
      },
      trim_ends: {
        type: "int",
        info: "Number of points at signal ends to down-weight to prevent edge artifacts.",
      },
    },
    reference_url: "https://pybaselines.readthedocs.io/en/stable/algorithms/whittaker.html",
  } satisfies HelpEntry,

  "Baseline.MODPOLY": {
    purpose:
      "Improved Modified Multi-polynomial fit (IModPoly) that iteratively fits a polynomial to the signal baseline.",
    parameters: {
      degree: {
        type: "int",
        info: "The degree of the polynomial to be fitted.",
      },
      tol: {
        type: "float",
        info: "Convergence tolerance.",
      },
      max_iter: {
        type: "int",
        info: "Maximum number of iterations.",
      },
    },
    reference_url:
      "https://pybaselines.readthedocs.io/en/stable/generated/api/functional/pybaselines.polynomial.imodpoly.html",
  } satisfies HelpEntry,

  "Baseline.FILLPEAKS": {
    purpose:
      "A morphological-Whittaker hybrid that iteratively fills peak regions to estimate the baseline.",
    parameters: {
      lambda: { type: "float/log", info: "10^lambda smoothness penalty." },
      hwi: { type: "int", info: "Half-window size for rolling mean statistics." },
      it: { type: "int", info: "Number of iterations." },
      int: { type: "int", info: "Number of buckets (segments) for mean estimation." },
    },
    reference_url: "https://rdrr.io/cran/baseline/man/baseline.fillPeaks.html",
  } satisfies HelpEntry,

  "Baseline.MEDIAN_WINDOW": {
    purpose:
      "Calculates a baseline using a running median filter, optionally followed by Gaussian smoothing.",
    parameters: {
      k_size: {
        type: "int",
        info: "Half-width for local medians (window size ≈ 2*k_size + 1).",
      },
      hws: { type: "float", info: "Half-width for optional Gaussian smoothing." },
      end: {
        type: "bool",
        info: "If true, uses asymmetric windows at endpoints instead of reflection padding.",
      },
    },
    reference_url: "https://rdrr.io/cran/baseline/man/baseline.medianWindow.html",
  } satisfies HelpEntry,

  "Baseline.ROLLING_BALL": {
    purpose:
      "Morphological baseline estimation that uses a rolling ball to follow the signal's lower envelope.",
    parameters: {
      half_window: { type: "int", info: "Radius of the ball (in points)." },
      smooth_half_window: {
        type: "int",
        info: "Window size for smoothing the signal before ball processing.",
      },
    },
    reference_url:
      "https://pybaselines.readthedocs.io/en/stable/generated/api/functional/pybaselines.morphological.rolling_ball.html",
  } satisfies HelpEntry,

  "Baseline.LOWPASS": {
    purpose:
      "Estimates the baseline using a Low-Pass FFT filter to remove high-frequency peaks.",
    parameters: {
      steep: { type: "float", info: "Steepness of the filter cutoff." },
      half: { type: "float", info: "Frequency (0–100) where filter response is 0.5." },
    },
    reference_url: "https://docs.scipy.org/doc/scipy/reference/generated/scipy.fft.rfft.html",
  } satisfies HelpEntry,

  "Baseline.PEAK_DETECTION": {
    purpose:
      "Custom peak-detection baseline method (valley-to-valley suppression) inspired by baseline.peakDetection.",
    parameters: {
      left: { type: "int", info: "Minimum valley-to-peak half-width (points)." },
      right: { type: "int", info: "Maximum valley-to-peak half-width (points)." },
      snminimum: { type: "float", info: "Signal-to-noise threshold to retain peaks." },
    },
    reference_url: "https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.find_peaks.html",
  } satisfies HelpEntry,
} as const;

function InfoTip({
  tip,
  direction = "bottom",
}: {
  tip: string;
  direction?: "bottom" | "top" | "left" | "right";
}) {
  const dirClass =
    direction === "top"
      ? "dropdown-top"
      : direction === "left"
        ? "dropdown-left"
        : direction === "right"
          ? "dropdown-right"
          : "dropdown-bottom";

  // Use a dropdown instead of tooltip pseudo-elements to avoid being clipped by the dialog.
  return (
    <div className={`dropdown dropdown-hover ${dirClass}`}>
      <button
        type="button"
        tabIndex={0}
        className="btn btn-xs btn-circle btn-ghost"
        aria-label="More info"
      >
        i
      </button>
      <div
        tabIndex={0}
        className="dropdown-content z-[9999] card card-compact w-80 bg-base-100 shadow p-3 text-sm whitespace-pre-line max-h-60 overflow-auto"
      >
        {tip}
      </div>
    </div>
  );
}

function formatHelpTip(entry?: HelpEntry, paramKey?: string): string {
  if (!entry) return "";
  const parts: string[] = [];
  if (entry.purpose) parts.push(entry.purpose);
  if (paramKey && entry.parameters?.[paramKey]) {
    const p = entry.parameters[paramKey];
    const meta = [p.type ? `Type: ${p.type}` : "", p.typical ? `Typical: ${p.typical}` : "", p.constraint ? `Constraint: ${p.constraint}` : ""]
      .filter(Boolean)
      .join(" | ");
    parts.push(`${paramKey}: ${p.info}${meta ? ` (${meta})` : ""}`);
  }
  if (entry.constraints?.length) parts.push(`Constraints: ${entry.constraints.join("; ")}`);
  if (entry.reference_url) {
    const refs = Array.isArray(entry.reference_url) ? entry.reference_url : [entry.reference_url];
    parts.push(`Docs: ${refs.join(" ")}`);
  }
  // Newlines keep the card readable and prevent extreme horizontal overflow.
  return parts.join("\n\n");
}

function extractApiErrorPayloadMessage(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;

  if (typeof payload === "object") {
    const p = payload as any;
    const candidate =
      p?.detail ??
      p?.message ??
      p?.error ??
      p?.errors ??
      p?.non_field_errors ??
      null;

    if (typeof candidate === "string") return candidate;
    try {
      return JSON.stringify(candidate ?? payload);
    } catch {
      return String(candidate ?? payload);
    }
  }

  return String(payload);
}

function formatNon200AxiosResponse(response: { status: number; statusText?: string; data?: unknown }): string {
  const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const payloadMsg = extractApiErrorPayloadMessage(response.data);
  return payloadMsg ? `${statusLabel}: ${payloadMsg}` : statusLabel;
}

function getApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response) {
      return formatNon200AxiosResponse({
        status: err.response.status,
        statusText: err.response.statusText,
        data: err.response.data,
      });
    }
    // No response: likely network/CORS/timeout
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

  type CalibrationPredictions = {
    equation?: string;
    concentrations?: number[];
  };
  
  type CalibrationResult = {
    r2?: number;
    rmse?: number;
    model_type?: string;
    plot_base64?: string;
    predictions?: CalibrationPredictions;
  };
  
const QuantTLC: React.FC = () => {
  // Channel selection state
  const channelOptions = [
    { label: "Red", value: "red" },
    { label: "Green", value: "green" },
    { label: "Blue", value: "blue" },
    { label: "Grayscale", value: "grayscale" },
  ];
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["red", "green", "blue", "grayscale"]);

  const handleChannelToggle = (channel: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((ch) => ch !== channel)
        : [...prev, channel]
    );
  };
    const router = useRouter();
    const searchParams = useSearchParams();
    const imageUrl = searchParams.get("image"); // Get the image URL from search params
const dispatch = useDispatch<AppDispatch>()
const [step, setStep] = useState(1);
const [bandStep, setBandStep] = useState(1);
const [selectedPreprocessing, setSelectedPreprocessing] = useState<PreprocessValue[]>([]);
const [showProcessed, setShowProcessed] = useState(false);
const [selectPeakEnabled, setSelectPeakEnabled] = useState(false);
const [densitogramData, setDensitogramData] = useState<{ hRF: number; raw: number; baseline: number; inverse: number; smooth: number }[]>([]);
const [filter, setFilter] = useState("");
// ...existing code...
const [selectedStandards, setSelectedStandards] = useState<Record<string, boolean>>({});
// Per-track toggle to include/exclude a track from calibration (standards + unknowns).
// Default is true when a key is absent.
const [tracksToCalibrate, setTracksToCalibrate] = useState<Record<string, boolean>>({});
// ...existing code...
const [selectedBandData, setSelectedBandData] = useState<[number] | null>(null);
const [standardData, setStandardData] = useState<{ [channelName: string]: DataPoint[] }>({});
const [refresh, setRefresh] = useState(false);
const [allPeaks, setAllPeaks] = useState<{ [channelName: string]: DataPoint[] }>({});
const [showCurve, setShowCurve] = useState(false);
const [quantityValues, setQuantityValues] = useState<Record<number, number>>({});
const [autoPeakValues, setAutoPeakValues] = useState<Record<number, number>>({});
const [selectedPeak, setSelectedPeak] = useState<{ channel: ChannelName; band: number; peak: DataPoint } | null>(null);
const [selectedPeakData, setSelectedPeakData] = useState<{ [channelName: string]: DataPoint[] } | null>(null);
// Regions stored per channel to avoid cross-channel churn
type RegionWithArea = { x0: number; x1: number; area?: number; channel?: string };
const [regionsByChannel, setRegionsByChannel] = useState<Record<string, RegionWithArea[]>>({});
// Track region areas per track (band) and channel
const [regionAreasByTrack, setRegionAreasByTrack] = useState<Record<number, Record<string, number>>>({});

const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);;
const [peakParams, setPeakParams] = useState<PeakDetectionParams>({
  minIncreasingSteps: 10,
  minDecreasingSteps: 10,
  minPeakHeight: 0.1,
  hrfRange: [0, 1000],
});
const [regions, setRegions] = useState([]);
// hRF Range tolerance for matching peaks across tracks
const [hRFRangeTolerance, setHRFRangeTolerance] = useState<number>(20);
// Quantity metric: choose between peak height and integrated area under the peak
const [quantityMetric, setQuantityMetric] = useState<'height' | 'area'>('height');
// Window (in samples) to integrate around peak x when using area
const [areaWindow, setAreaWindow] = useState<number>(5);
const [preprocessedData, setPreprocessedData] = useState<PreprocessedOutput | null>(null);

// API-based peak detection state
const [apiPeakParams, setApiPeakParams] = useState<PeakDetectionApiParams>({
  min_peak_height:null,
  peak_threshold: null,
  distance_bw_peaks:null,
  peak_prominence: null,
  peak_width: null,
  peak_wlen: null,
  peak_el_height: null,
  peak_plateau_size: null,
  peak_Min_peak_area: null,
  find_area: true,
  change_area: [],
  edit_peak_integration: [],
});
// Optional upper bound for min_peak_height range
const [maxPeakHeight, setMaxPeakHeight] = useState<number | null>(null);
const [apiPeaksResponse, setApiPeaksResponse] = useState<PeakDetectionApiResponse | null>(null);
const [apiPeaksLoading, setApiPeaksLoading] = useState(false);
const [preprocessLoading, setPreprocessLoading] = useState(false);
const [calibrationLoading, setCalibrationLoading] = useState(false);

// Helper function to merge new API response with existing state
// This preserves data from channels that were not modified
const mergeApiPeaksResponse = useCallback((newResponse: PeakDetectionApiResponse) => {
  setApiPeaksResponse(prevResponse => {
    if (!prevResponse) {
      // No previous response, use the new one as-is
      return newResponse;
    }
    
    // Deep merge: preserve existing tracks/channels, update with new data
    const merged: PeakDetectionApiResponse = { ...prevResponse };
    
    for (const trackKey of Object.keys(newResponse)) {
      if (!merged[trackKey]) {
        // New track, add it
        merged[trackKey] = newResponse[trackKey];
      } else {
        // Existing track, merge channels
        merged[trackKey] = { ...merged[trackKey] };
        const newTrack = newResponse[trackKey];
        
        for (const channelKey of Object.keys(newTrack) as Array<keyof typeof newTrack>) {
          // Update/replace channel data from new response
          merged[trackKey][channelKey] = newTrack[channelKey];
        }
      }
    }
    
    console.log('[quantTLC] Merged API response:', merged);
    return merged;
  });
}, []);

// Transformed peaks ready for chart consumption
const apiChartPeaks = useMemo<AllTracksChartPeaks>(() => {
  if (!apiPeaksResponse) return {};
  return transformApiPeaksToChartPeaks(apiPeaksResponse);
}, [apiPeaksResponse]);

type CalibrationModel = 'none' | 'hill' | 'mm_origin' | 'mm_intercept' | 'linear' | 'linear_origin'| 'poly2';
const [modelType, setModelType] = useState<CalibrationModel>('none');
const modelOptions: { value: CalibrationModel; label: string }[] = [
  { value: 'none', label: 'Select model' },
  { value: 'hill', label: 'Hill' },
  { value: 'mm_origin', label: 'Michaelis–Menten (origin)' },
  { value: 'mm_intercept', label: 'Michaelis–Menten (+ intercept)' },
  { value: 'linear', label: 'Linear' },
  { value: 'linear_origin', label: 'Linear (origin)' },
  {value: 'poly2', label: 'Polynomial' }
];
// .

type SelectedPeakState = {
  channel: string;
  peak: any; // adjust type if you know it
};

const [selectedPeakNew, setSelectedPeakNew] = useState<SelectedPeakState | null>(null);

const [advancedOptions, setAdvancedOptions] = useState({
  smoothing: {
    windowSize: '15',
    polynomialOrder: '2',
    differentiationOrder: '0',
  },
  baseline: {
    type: 'ASLS',
    params: { lam: '5', p: '0.05', max_iter: '20' } as Record<string, string>,
  },
  warping: {
    method: 'PTW',
    referenceTrack: '1',
    dtw: '',
    ptw: '1',
    degree: '2',
    seg_len: '100',
  },
});
console.log("advanced options ", advancedOptions);

  type QuantFormData = {
    real_width_mm: string;
    real_height_mm: string;
    crop_bottom_mm: string;
    crop_top_mm: string;
    first_band_mm: string;
    band_spacing_mm: string;
    num_bands: string;
    estimated_band_width_mm: string;
  };

  const [formData, setFormData] = useState<QuantFormData>({
        real_width_mm: searchParams.get("real_width_mm") || "200.0",
        real_height_mm: searchParams.get("real_height_mm") || "100.0",
        crop_bottom_mm: searchParams.get("crop_bottom_mm") || "8.0",
        crop_top_mm: searchParams.get("crop_top_mm") || "60.0",
        first_band_mm: searchParams.get("first_band_mm") || "16.0",
        band_spacing_mm: searchParams.get("band_spacing_mm") || "10.5",
        num_bands: searchParams.get("num_bands") || "17",
        // dynamically computed; always kept as non-negative float string
        estimated_band_width_mm: searchParams.get("estimated_band_width_mm") || "0.0",
    });
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

const peakRef = useRef<{ [channelName: string]: DataPoint[] }>({});
const chartRef = useRef<D3InteractiveChartHandle>(null);
// const params: PeakDetectionParams = {
//     minIncreasingSteps: 5,
//     minDecreasingSteps: 5,
//     minPeakHeight: -0.5,
//     hrfRange: [0, 1000],
//   };   

// Add UI alert state
const [uiAlert, setUiAlert] = useState<{ type: 'warning' | 'error' | 'success'; message: string } | null>(null);
const alertTimerRef = useRef<number | undefined>(undefined);
const notify = useCallback((type: 'warning' | 'error' | 'success', message: string) => {
  setUiAlert({ type, message });
  if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
  alertTimerRef.current = window.setTimeout(() => setUiAlert(null), 5000) as unknown as number;
}, []);
// ...existing code...

console.log("peakref",peakRef.current)
console.log('#2#2#2#2#2#2#2#2#2#2#2#');
// console.log(peaksByChannel, regionsByChannel, selectedPeakByChannel);
// console.log('#2#2#2#2#2#2#2#2#2#2#2#');
// console.log(peaksByChannel);
// console.log('#2#2#2#2#2#2#2#2#2#2#2#');
// console.log(selectedPeakByChannel);
const prevSelectedPeakRef = useRef<Record<string, any[]>>({});
const clone = <T,>(obj: T) => JSON.parse(JSON.stringify(obj));

const isSamePeakArray = (a?: any[], b?: any[]) => {
  if (!Array.isArray(a) && !Array.isArray(b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  // You keep only one item per channel; compare that one
  if (a.length === 0 && b.length === 0) return true;
  return JSON.stringify(a[0]) === JSON.stringify(b[0]);
};

const baselineDefaults: Record<string, Record<string, string>> = {
  IRLS: { lambda1: "", lambda2: "", wi: "", max_iter: "" },
  ASLS: { lam: "5", p: "0.05", max_iter: "20" },
  MODPOLY: { degree: "", tol: "", max_iter: "" },
  FILLPEAKS: { lambda: "", hwi: "", it: "", int: "" },
  MEDIAN_WINDOW: { k_size: "", hws: "", end: "" },
  ROLLING_BALL: { half_window: "", smooth_half_window: "" },
  LOWPASS: { steep: "", half: "" },
  PEAK_DETECTION: {
    left: "", right: "", lwin: "", rwin: "",
    height: "", distance: "", prominence: "", snminimum: ""
  },
};

const baselineTypes = Object.keys(baselineDefaults);

const warpingMethods = ["DTW", "PTW"];

const coerce = (v: string) => {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : v; // turn "10" -> 10, keep strings if not numeric
};



// ---- Handlers (assumes your advancedOptions state) ----
const handleBaselineTypeChange = (newType: string) => {
  setAdvancedOptions(prev => ({
    ...prev,
    baseline: {
      type: newType,
      // attach correct param set for this type
      params: { ...(baselineDefaults[newType] ?? {}) },
    },
  }));
};

const handleBaselineParamChange = (key: string, value: string) => {
  setAdvancedOptions(prev => ({
    ...prev,
    baseline: {
      ...prev.baseline,
      params: { ...(prev.baseline as any).params, [key]: value },
    },
  }));
};

const handleWarpingMethodChange = (method: string) => {
  setAdvancedOptions(prev => ({
    ...prev,
    warping: {
      ...prev.warping,
      method,
    },
  }));
};

const buildPreprocessOption = () => {

  const baselineTypeMap: Record<string, string> = {
    PEAK_DETECTION: 'peakDetection',
    IRLS: 'irls',
    ASLS: 'asls',
    MODPOLY: 'modpoly',
    FILLPEAKS: 'fillpeaks',
    MEDIAN_WINDOW: 'medianWindow',
    ROLLING_BALL: 'rollingBall',
    LOWPASS: 'lowpass',
  };

  const warpingMethods = ["DTW", "PTW"];


  const baselineType = advancedOptions.baseline.type;
  const baselineParams = advancedOptions.baseline.params || {};

  // ---- Smoothing ----
  // Backend expects: preprocess_option['Smoothing'] = {'window.size': int, 'poly.order': int, 'diff.order': int}
  const smoothingWindow = coerce(advancedOptions.smoothing.windowSize);
  const smoothingPoly = coerce(advancedOptions.smoothing.polynomialOrder);
  const smoothingDiff =
    advancedOptions.smoothing.differentiationOrder === ''
      ? 0
      : (coerce(advancedOptions.smoothing.differentiationOrder) ?? 0);

  const Smoothing: Record<string, any> | null =
    smoothingWindow === null || smoothingPoly === null
      ? null
      : {
          'window.size': smoothingWindow,
          'poly.order': smoothingPoly,
          'diff.order': smoothingDiff,
        };

  // For PEAK_DETECTION we want the flat structure shown in your example:
  // {"baseline": {"type": "peakDetection","left": 10, ...}}
  // For others we’ll still send the same shape: { type: "<mapped>", ...params }
  const baseline: Record<string, any> = {
    type: baselineTypeMap[baselineType] ?? baselineType?.toLowerCase() ?? null,
  };

  Object.entries(baselineParams).forEach(([k, v]) => {
    baseline[k] = coerce(String(v));
  });

  // ---- Warping ----
  // Your example shows:
  // "Warping":{"ptw":13,"degree":2,"seg_len":100}
  // If DTW is used you previously had: {"dtw": 14}
  const Warping: Record<string, any> = {};
  if (advancedOptions.warping.method === 'DTW') {
    Warping.dtw = coerce(advancedOptions.warping.dtw);
  } else if (advancedOptions.warping.method === 'PTW') {
    Warping.ptw = coerce(advancedOptions.warping.ptw);
    Warping.degree = coerce(advancedOptions.warping.degree);
    Warping.seg_len = coerce(advancedOptions.warping.seg_len);
  }

  return {
    baseline,
    Warping, // note capital W to match your example exactly
    ...(Smoothing ? { Smoothing } : {}),
  };
};

const handleSaveAdvancedOptions = async () => {
  try {
    // Normalize to backend step names
    const preprocessOrder = selectedPreprocessing.map((v: PreprocessValue) =>
      v === 'smoothing' ? 'Smoothing' : v === 'warping' ? 'Warping' : v
    );

    const preprocessOption = buildPreprocessOption();
    if (!selectedPreprocessing.includes('baseline')) delete (preprocessOption as any).baseline;
    if (!selectedPreprocessing.includes('smoothing')) delete (preprocessOption as any).Smoothing;
    if (!selectedPreprocessing.includes('warping')) delete (preprocessOption as any).Warping;

    // allTracks should be your raw densitogram input per track/channel
    // e.g., const allTracks: AllTracksInput = { "1": { red: [...], green: [...], ... }, ... }
    const processed = await preprocessAllTracksAPI(
      bandData,                // <-- make sure this exists in your component
      preprocessOrder,
      preprocessOption
    );

    // TODO: set the processed data into state or pass it forward
    setPreprocessedData(processed);
    // close modal
    (document.getElementById('advanced_modal') as HTMLDialogElement)?.close();
  } catch (e) {
    console.error(e);
    notify('error', `Preprocessing failed: ${getApiErrorMessage(e)}`);
  }
};



const { data, loading, error } = useSelector((state: RootState) => state.data)    
console.log('data',data );
// Safely normalize densitogram data (can be object or JSON string)
const bandData = useMemo(() => {
  const raw = data?.densitogram_data;
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[quantTLC] Failed to parse densitogram_data JSON', e);
      return null;
    }
  }

  return raw;
}, [data?.densitogram_data]);

// If the densitogram API fails, do not redirect. Show the error and let the user retry.
useEffect(() => {
  if (!loading && error) {
    notify('error', `Densitogram API failed: ${String(error)}`);
  }
}, [loading, error, notify]);

// Keep the user on Step 1 until we have densitogram data.
useEffect(() => {
  if (!loading && !bandData) {
    setStep(1);
  }
}, [loading, bandData]);
 // Ensure hook always runs; internal conditional sets state only when data is ready
 useEffect(() => {
  if (!loading && !error && data?.densitogram_data) {
    setPreprocessedData(data.densitogram_data);
  }
 }, [loading, error, data?.densitogram_data]);
let allPeaksData = {};

const allPeaksRef = useRef<{
  red: DataPoint[];
  green: DataPoint[];
  blue: DataPoint[];
  grayscale: DataPoint[];
}>({
  red: [],
  green: [],
  blue: [],
  grayscale: [],
});


function convertChannelDataToDensitogramArray(channelData: { [channel: string]: DataPoint[] }): { hRF: number; red: number; green: number; blue: number; grayscale: number }[] {
  
  console.log('convertChannelDataToDensitogramArray ****',channelData);
  

  const length = Math.max(
    channelData.red?.length ?? 0,
    channelData.green?.length ?? 0,
    channelData.blue?.length ?? 0,
    channelData.grayscale?.length ?? 0
  );
  return Array.from({ length }).map((_, i) => ({
    hRF: i,
    red: channelData.red?.[i]?.y ?? 0,
    green: channelData.green?.[i]?.y ?? 0,
    blue: channelData.blue?.[i]?.y ?? 0,
    grayscale: channelData.grayscale?.[i]?.y ?? 0,
  }));
}

const handleProcessedData = (processeddata: { [channel: string]: DataPoint[] }) => {
  console.log('processeddata &&&&&&&&', processeddata);
  const densitogramArray = convertChannelDataToDensitogramArray(processeddata);
  console.log('densitogramaraay', densitogramArray);
  
  const allPeaks = processAllBands(densitogramArray, peakParams);
  allPeaksRef.current = allPeaks;
};

// Handler for when a peak is selected in the chart - updates selectedPeak state immediately
const handlePeakSelect = useCallback((peak: DataPoint, channelName: string) => {
  console.log('[handlePeakSelect] Peak selected:', peak, 'Channel:', channelName);
  const newSelectedPeak = {
    channel: channelName as ChannelName,
    band: bandStep,
    peak: peak,
  };
  setSelectedPeak(newSelectedPeak);
  console.log('[handlePeakSelect] Updated selectedPeak state:', newSelectedPeak);
}, [bandStep]);

const handleRegionsChange = useCallback((newRegions: RegionWithArea[]) => {
  if (!newRegions || newRegions.length === 0) return;
  const ch = newRegions[0].channel || 'unknown';
  setRegionsByChannel(prev => {
    const existing = prev[ch] || [];
    const sameLen = existing.length === newRegions.length;
    const sameContent = sameLen && existing.every((r, i) => r.x0 === newRegions[i].x0 && r.x1 === newRegions[i].x1 && r.area === newRegions[i].area);
    if (sameContent) return prev; // no real change
    return { ...prev, [ch]: newRegions };
  });
  
  // Calculate and store total region area for current track and channel
  const totalArea = newRegions.reduce((sum, r) => sum + (r.area || 0), 0);
  const trackIndex = bandStep - 1;
  setRegionAreasByTrack(prev => ({
    ...prev,
    [trackIndex]: {
      ...prev[trackIndex],
      [ch]: totalArea
    }
  }));
}, [bandStep]);

// Debug: compact signature to see actual updates
useEffect(() => {
  const sig = Object.entries(regionsByChannel).map(([c, regs]) => `${c}(${regs.length})`).join(', ');
  if (sig) console.log('📥 Regions updated:', sig);
  console.log('📊 Region areas by track:', regionAreasByTrack);
}, [regionsByChannel, regionAreasByTrack]);



// const handleProcessedData = (processeddata) => {
// const allPeaks = processAllBands(processeddata, params);
//   // console.log("Received from child and all peaks processed:", allPeaks);
// // setAllPeaks(allPeaks); // Store all peaks in state
// allPeaksData = allPeaks; // Store all peaks in a variable
// console.log('allPeaksData',allPeaksData);



// const mockallPeaksData = {
//   band1: {
//     red: [{ x: 10, y: 0.8 }, { x: 50, y: 0.6 }],
//     green: [{ x: 533, y: 0.68 }, { x: 100, y: 0.5 }],
//     blue: [{ x: 30, y: 0.4 }],
//     grayscale: [{ x: 60, y: 0.7 }],
//   },
//   band2: {
//     red: [{ x: 10, y: 0.7 }],
//     green: [{ x: 532, y: 0.65 }], // within ±1 of 533
//     blue: [{ x: 25, y: 0.5 }],
//     grayscale: [{ x: 60, y: 0.6 }],
//   },
// };
// const selectedPeak = {
//   x: 533,
//   y: 0.6835687812214643,
//   channel: "green" as const, // narrowed type
// };

// // ✅ Validate it
// const isValid = validatePeakSelection(mockallPeaksData, selectedPeak, 2);

// console.log("Is selected peak valid across multiple tracks?", isValid);
//   // You can store it in state or perform other logic
// };
// useEffect(() => {

function computePeakArea(data: { x: number; y: number }[], peakX: number, window = 5) {
  // Find the index of the peak
  const peakIdx = data.findIndex(d => d.x === peakX);
  if (peakIdx === -1) return 0;

  // Define integration window
  const leftIdx = Math.max(peakIdx - window, 0);
  const rightIdx = Math.min(peakIdx + window, data.length - 1);

  let area = 0;
  for (let i = leftIdx; i < rightIdx; i++) {
    const dx = data[i + 1].x - data[i].x;
    const avgY = (data[i].y + data[i + 1].y) / 2;
    area += dx * avgY;
  }
  return area;
}

// Unified quantity extraction given metric selection
function getPeakQuantity(
  bandDataArr: { x: number; y: number }[],
  peak: DataPoint,
  metric: 'height' | 'area',
  areaWindow: number
): number {
  if (!peak) return 0;
  if (metric === 'height') return Number.isFinite(peak.y) ? peak.y : 0;
  return computePeakArea(bandDataArr, peak.x, areaWindow);
}




// }, [data]); 


  console.log("BAND", bandData);

  const totalTracks =
    bandData && typeof bandData === "object" ? Object.keys(bandData as any).length : 0;

    const preprocessingSteps = ["Baseline Correction", "Smoothing", "Inverse Peak"];

    type ChannelData = {
      red: number[];
      green: number[];
      blue: number[];
      grayscale: number[];
    };
    
    type PreprocessedData = Record<string, ChannelData>;

// ...existing code...
// const preprocessedData = await preprocessAllTracksAPI(bandData, preprocessingSteps);

// ...existing code...
// Replace the current toDataUrl with this safe version
const toDataUrl = (b64?: string | null, mime = "image/png") => {
  if (!b64 || typeof b64 !== "string") return "";
  const s = b64.trim();
  if (!s) return "";
  // pass through if already a data URL, blob URL, or http(s) URL
  if (s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("http")) return s;
  return `data:${mime};base64,${s}`;
};
// ...existing code...

const calibrateImg = useMemo(() => {
  const b64 = (calibrationResult as any)?.plot_base64;
  return b64 ? toDataUrl(b64, "image/png") : "";
}, [calibrationResult]);
console.log('calibrateImg', calibrateImg);
// --- Types (optional but nice)
// Use the imported `ChannelName` from utils/peakDetection (avoid redeclaring)
type BandEntry = Record<ChannelName, number[]> & { band_image: string };
type BandsResponse = Record<string, BandEntry>; // keys: "1","2","3",...

// props/state you already have:
// const [bandStep, setBandStep] = useState<number>(1);
// const totalTracks = Object.keys(data).length;
// const data: BandsResponse = ... (your API response)

const currentEntry: BandEntry | undefined = (bandData as BandsResponse)?.[String(bandStep)];
const imgSrc = currentEntry ? toDataUrl(currentEntry.band_image, "image/png") : "";
const markedImg = (data as any)?.marked_image ? toDataUrl((data as any).marked_image, "image/png") : "";  




console.log('current');
console.log(currentEntry);



const handlePreProcess = async () => {
  setPreprocessLoading(true);
  try {
    const preprocessOrder = selectedPreprocessing.map((v: PreprocessValue) =>
      v === 'smoothing' ? 'Smoothing' : v === 'warping' ? 'Warping' : v
    );
    console.log(preprocessOrder);

    const preprocessOption = buildPreprocessOption();
    if (!selectedPreprocessing.includes('baseline')) delete (preprocessOption as any).baseline;
    if (!selectedPreprocessing.includes('smoothing')) delete (preprocessOption as any).Smoothing;
    if (!selectedPreprocessing.includes('warping')) delete (preprocessOption as any).Warping;

    const data = await preprocessAllTracksAPI(bandData, preprocessOrder, preprocessOption);
    // <- here you have the processed data (not a Promise)
    setPreprocessedData(data);
  } catch (e) {
    console.error(e);
    notify('error', `Preprocessing failed: ${getApiErrorMessage(e)}`);
  } finally {
    setPreprocessLoading(false);
  }
};

// Build API params ensuring min_peak_height can be either a number or a [min,max] range
const buildApiPeakParamsForRequest = useCallback(
  (overrides: Partial<PeakDetectionApiParams> = {}) => {
    const merged: PeakDetectionApiParams = { ...apiPeakParams, ...overrides };

    const min =
      typeof merged.min_peak_height === 'number' && Number.isFinite(merged.min_peak_height)
        ? merged.min_peak_height
        : null;
    const max = typeof maxPeakHeight === 'number' && Number.isFinite(maxPeakHeight) ? maxPeakHeight : null;

    const min_peak_height =
      min !== null && max !== null
        ? ([Math.min(min, max), Math.max(min, max)] as [number, number])
        : min;

    return {
      ...merged,
      // backend accepts either number or [min,max]
      min_peak_height,
    } as any;
  },
  [apiPeakParams, maxPeakHeight]
);

// API call to fetch peaks from server
const fetchPeaksFromApi = useCallback(async () => {
  if (!preprocessedData) {
    console.warn('No preprocessed data available for peak detection');
    return;
  }

  setApiPeaksLoading(true);
  try {
    const requestBody = {
      params: buildApiPeakParamsForRequest(),
      processed_data: preprocessedData,
    };

    const response = await axios.post<PeakDetectionApiResponse>(
      apiUrl('/peak_integration/'),
      requestBody,
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    if (response.status !== 200) {
      throw new Error(formatNon200AxiosResponse({ status: response.status, statusText: response.statusText, data: response.data }));
    }

    console.log('Peak Detection API Response:', response.data);
    setApiPeaksResponse(response.data);
    notify('success', 'Peak detection completed.');
  } catch (err) {
    console.error('Peak Detection API error:', err);
    notify('error', `Peak detection failed: ${getApiErrorMessage(err)}`);
  } finally {
    setApiPeaksLoading(false);
  }
}, [preprocessedData, buildApiPeakParamsForRequest, notify]);

// Handler for peak area changes from the chart component
const handlePeakAreaChange = useCallback(async (changeInfo: PeakAreaChangeInfo) => {
  if (!preprocessedData) {
    console.warn('No preprocessed data available for peak area change');
    return;
  }

  console.log('Peak area changed:', changeInfo);

  // Create the change_area item for API
  const changeAreaItem: ChangeAreaItem = {
    band_key: changeInfo.bandKey,
    channel_name: changeInfo.channelName,
    peak_index: changeInfo.peakIndex,
    new_start: changeInfo.newStart,
    new_end: changeInfo.newEnd,
  };

  // Accumulate changes so subsequent edits don't revert earlier ones.
  // Identity: (band_key, channel_name, peak_index)
  const prevChangeAreas = apiPeakParams.change_area ?? [];
  const changeKey = (c: ChangeAreaItem) => `${c.band_key}::${c.channel_name}::${c.peak_index}`;
  const nextChangeAreas: ChangeAreaItem[] = (() => {
    const key = changeKey(changeAreaItem);
    const deduped = prevChangeAreas.filter((c: ChangeAreaItem) => changeKey(c) !== key);
    return [...deduped, changeAreaItem];
  })();

  setApiPeakParams((prev: PeakDetectionApiParams) => ({ ...prev, change_area: nextChangeAreas }));

  // Update params with the change_area and call API
  setApiPeaksLoading(true);
  try {
    const requestBody = {
      params: {
        ...buildApiPeakParamsForRequest({ change_area: nextChangeAreas }),
        change_area: nextChangeAreas,
      },
      processed_data: preprocessedData,
    };

    console.log('Sending peak area change request:', requestBody);

    const response = await axios.post<PeakDetectionApiResponse>(
      apiUrl('/peak_integration/'),
      requestBody,
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    if (response.status !== 200) {
      throw new Error(formatNon200AxiosResponse({ status: response.status, statusText: response.statusText, data: response.data }));
    }

    console.log('Peak Area Change API Response:', response.data);
    mergeApiPeaksResponse(response.data);
    notify('success', 'Peak area updated successfully.');
  } catch (err) {
    console.error('Peak Area Change API error:', err);
    notify('error', `Peak area update failed: ${getApiErrorMessage(err)}`);
  } finally {
    setApiPeaksLoading(false);
  }
}, [preprocessedData, apiPeakParams, notify, mergeApiPeaksResponse, buildApiPeakParamsForRequest]);

// Handler for edit_peak_integration API (update, add, delete operations)
const handleEditPeakIntegration = useCallback(async (editInfo: EditPeakIntegrationInfo) => {
  if (!preprocessedData) {
    console.warn('No preprocessed data available for peak integration edit');
    return;
  }

  console.log('Edit peak integration:', editInfo);

  // Build the edit_peak_integration item for API
  const editItem: EditPeakIntegrationItem = {
    edit_type: editInfo.editType as any,
    band_key: editInfo.bandKey,
    channel_name: editInfo.channelName,
    peak_x: editInfo.peakIndex,
  };

  // Add new_start and new_end only for 'add' and 'update' operations
  if (editInfo.editType === 'add' || editInfo.editType === 'update') {
    editItem.new_start = editInfo.newStart;
    editItem.new_end = editInfo.newEnd;
  }

  // Accumulate edit_peak_integration items so updates to multiple peaks persist.
  // Identity: (band_key, channel_name, peak_x)
  const prevEdits = apiPeakParams.edit_peak_integration ?? [];
  const editKey = (e: any) => `${e.band_key}::${e.channel_name}::${e.peak_x}`;
  const nextEdits: EditPeakIntegrationItem[] = (() => {
    const key = editKey(editItem);
    const deduped = (prevEdits as EditPeakIntegrationItem[]).filter((e: EditPeakIntegrationItem) => editKey(e) !== key);
    return [...deduped, editItem];
  })();

  setApiPeakParams((prev: PeakDetectionApiParams) => ({ ...prev, edit_peak_integration: nextEdits }));

  setApiPeaksLoading(true);
  try {
    const requestBody = {
      params: buildApiPeakParamsForRequest({ edit_peak_integration: nextEdits }),
      processed_data: preprocessedData,
    };

    console.log('Sending edit_peak_integration request:', requestBody);

    const response = await axios.post<PeakDetectionApiResponse>(
      apiUrl('/peak_integration/'),
      requestBody,
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    if (response.status !== 200) {
      throw new Error(formatNon200AxiosResponse({ status: response.status, statusText: response.statusText, data: response.data }));
    }

    console.log('Edit Peak Integration API Response:', response.data);
    mergeApiPeaksResponse(response.data);
    
    const actionLabel = editInfo.editType === 'add' ? 'added' : 
                        editInfo.editType === 'delete' ? 'deleted' : 'updated';
    notify('success', `Peak ${actionLabel} successfully.`);
  } catch (err) {
    console.error('Edit Peak Integration API error:', err);
    notify('error', `Peak ${editInfo.editType} failed: ${getApiErrorMessage(err)}`);
  } finally {
    setApiPeaksLoading(false);
  }
}, [preprocessedData, apiPeakParams, buildApiPeakParamsForRequest, notify, mergeApiPeaksResponse]);

// Handler for batch adding multiple peaks at once
const handleBatchAddPeaks = useCallback(async (batchInfo: BatchAddPeaksInfo) => {
  if (!preprocessedData) {
    console.warn('No preprocessed data available for batch add peaks');
    return;
  }

  if (batchInfo.newPeaks.length === 0) {
    console.warn('No new peaks to add');
    return;
  }

  console.log('Batch add peaks:', batchInfo);

  // Build array of edit_peak_integration items for all new peaks
  const editItems: EditPeakIntegrationItem[] = batchInfo.newPeaks.map(peak => ({
    edit_type: 'add',
    band_key: batchInfo.bandKey,
    channel_name: batchInfo.channelName,
    peak_x: peak.peakX,
    new_start: peak.newStart,
    new_end: peak.newEnd,
  }));

  setApiPeaksLoading(true);
  try {
    const prevEdits = apiPeakParams.edit_peak_integration ?? [];
    const editKey = (e: any) => `${e.band_key}::${e.channel_name}::${e.peak_x}`;
    const mergedEdits = [...prevEdits];
    for (const item of editItems) {
      const key = editKey(item);
      const idx = mergedEdits.findIndex((e: any) => editKey(e) === key);
      if (idx >= 0) mergedEdits[idx] = item;
      else mergedEdits.push(item);
    }
    setApiPeakParams((prev: PeakDetectionApiParams) => ({ ...prev, edit_peak_integration: mergedEdits as EditPeakIntegrationItem[] }));

    const requestBody = {
      params: buildApiPeakParamsForRequest({ edit_peak_integration: mergedEdits }),
      processed_data: preprocessedData,
    };

    console.log('Sending batch add peaks request:', requestBody);

    const response = await axios.post<PeakDetectionApiResponse>(
      apiUrl('/peak_integration/'),
      requestBody,
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    if (response.status !== 200) {
      throw new Error(formatNon200AxiosResponse({ status: response.status, statusText: response.statusText, data: response.data }));
    }

    console.log('Batch Add Peaks API Response:', response.data);
    mergeApiPeaksResponse(response.data);
    
    notify('success', `${batchInfo.newPeaks.length} peak(s) added successfully.`);
  } catch (err) {
    console.error('Batch Add Peaks API error:', err);
    notify('error', `Adding peaks failed: ${getApiErrorMessage(err)}`);
  } finally {
    setApiPeaksLoading(false);
  }
}, [preprocessedData, apiPeakParams, buildApiPeakParamsForRequest, notify, mergeApiPeaksResponse]);

// Cross-channel add peak mode state
const [globalAddPeakMode, setGlobalAddPeakMode] = useState(false);
// Track all newly added regions across all channels
const allNewRegionsRef = useRef<{ x0: number; x1: number; peakX: number; channelName: string }[]>([]);

// Handler for when a new region is added in any channel
const handleNewRegionAdded = useCallback((region: { x0: number; x1: number; peakX: number; channelName: string }) => {
  allNewRegionsRef.current = [...allNewRegionsRef.current, region];
  console.log('[quantTLC] New region added across channels:', region, 'Total:', allNewRegionsRef.current.length);
}, []);

// Handler for add peak mode toggle - syncs across all channels
const handleAddPeakModeToggle = useCallback(async (isAddMode: boolean) => {
  if (isAddMode) {
    // Entering add mode - clear previous regions
    allNewRegionsRef.current = [];
    console.log('[quantTLC] Entering global add peak mode');
  } else {
    // Exiting add mode - send all regions from all channels
    const allRegions = allNewRegionsRef.current;
    console.log('[quantTLC] Exiting global add peak mode, all regions:', allRegions);
    
    if (allRegions.length > 0 && preprocessedData && bandStep !== undefined) {
      // Group regions by channel
      const editItems: EditPeakIntegrationItem[] = allRegions.map(region => ({
        edit_type: 'add',
        band_key: String(bandStep),
        channel_name: region.channelName,
        peak_x: region.peakX,
        new_start: Math.round(region.x0),
        new_end: Math.round(region.x1),
      }));
      
      setApiPeaksLoading(true);
      try {
        const prevEdits = apiPeakParams.edit_peak_integration ?? [];
        const editKey = (e: any) => `${e.band_key}::${e.channel_name}::${e.peak_x}`;
        const mergedEdits = [...prevEdits];
        for (const item of editItems) {
          const key = editKey(item);
          const idx = mergedEdits.findIndex((e: any) => editKey(e) === key);
          if (idx >= 0) mergedEdits[idx] = item;
          else mergedEdits.push(item);
        }
        setApiPeakParams((prev: PeakDetectionApiParams) => ({ ...prev, edit_peak_integration: mergedEdits as EditPeakIntegrationItem[] }));

        const requestBody = {
          params: buildApiPeakParamsForRequest({ edit_peak_integration: mergedEdits }),
          processed_data: preprocessedData,
        };

        console.log('[quantTLC] Sending cross-channel batch add peaks request:', requestBody);

        const response = await axios.post<PeakDetectionApiResponse>(
          apiUrl('/peak_integration/'),
          requestBody,
          { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        if (response.status !== 200) {
          throw new Error(formatNon200AxiosResponse({ status: response.status, statusText: response.statusText, data: response.data }));
        }

        console.log('[quantTLC] Cross-channel Batch Add Peaks API Response:', response.data);
        mergeApiPeaksResponse(response.data);
        
        notify('success', `${allRegions.length} peak(s) added across channels successfully.`);
      } catch (err) {
        console.error('[quantTLC] Cross-channel Batch Add Peaks API error:', err);
        notify('error', `Adding peaks failed: ${getApiErrorMessage(err)}`);
      } finally {
        setApiPeaksLoading(false);
      }
    }
    
    // Clear all regions after sending
    allNewRegionsRef.current = [];
  }
  
  setGlobalAddPeakMode(isAddMode);
}, [preprocessedData, bandStep, apiPeakParams, buildApiPeakParamsForRequest, notify, mergeApiPeaksResponse]);

// Automatically fetch peaks when preprocessed data changes
useEffect(() => {
  if (preprocessedData && Object.keys(preprocessedData).length > 0) {
    fetchPeaksFromApi();
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [preprocessedData]); // intentionally not including fetchPeaksFromApi to avoid infinite loop

console.log("preeeeeeeproceeesssededededed");

console.log(preprocessedData);

// ...existing code...
console.log('preprocessedData',preprocessedData);

const allPeaksOverAllData = useMemo<ReturnType<typeof processAllTracksFromPreprocessed>>(() => {
  if (!preprocessedData) {
    return {} as ReturnType<typeof processAllTracksFromPreprocessed>;
  }
  return processAllTracksFromPreprocessed(preprocessedData, peakParams);
}, [preprocessedData, peakParams]);

console.log('allPeaksOverAllData',allPeaksOverAllData);

 // Get the image URL for the given bandStep
 const bandKey = String(bandStep); // Ensure it's a string for object key lookup
 const imageUrlBand = bandData[bandKey]?.image_url;

 console.log('ib',imageUrlBand);

// Get current track's peaks from API response
const currentTrackApiPeaks = useMemo(() => {
  return apiChartPeaks[bandKey] ?? { red: [], green: [], blue: [], grayscale: [] };
}, [apiChartPeaks, bandKey]);

// Memoized series per channel to avoid re-allocating arrays every parent render
const redData = useMemo(
  () => (preprocessedData?.[bandKey]?.red ?? []).map((y, x) => ({ x, y })),
  [preprocessedData, bandKey]
);
const blueData = useMemo(
  () => (preprocessedData?.[bandKey]?.blue ?? []).map((y, x) => ({ x, y })),
  [preprocessedData, bandKey]
);
const greenData = useMemo(
  () => (preprocessedData?.[bandKey]?.green ?? []).map((y, x) => ({ x, y })),
  [preprocessedData, bandKey]
);
const grayData = useMemo(
  () => (preprocessedData?.[bandKey]?.grayscale ?? []).map((y, x) => ({ x, y })),
  [preprocessedData, bandKey]
);

console.log("blue data", blueData);


// Flatten and map to table-ready format - API peaks only (fallback disabled)
const allPeaksForTable = useMemo(() => {
  // Use API peaks only
  if (apiPeaksResponse && Object.keys(apiChartPeaks).length > 0) {
    return Object.entries(apiChartPeaks).flatMap(([trackKey, channels]) =>
      Object.entries(channels).flatMap(([channel, peaks]) =>
        (peaks as ChartPeak[]).map((peak) => ({
          track: parseInt(trackKey) || 0,
          channels: channel,
          startHRF: peak.startX,
          endHRF: peak.endX,
          hRF: peak.x,
          height: peak.y.toFixed(4),
          area: peak.area.toFixed(4),
          quantity: quantityMetric === 'height' ? peak.y.toFixed(4) : peak.area.toFixed(4)
        }))
      )
    );
  }

  // No API peaks - return empty array (fallback disabled)
  return [];

  // COMMENTED OUT: Fallback to client-side calculation - using API only
  // return Object.entries(allPeaksOverAllData).flatMap(([trackKey, channels]) =>
  //   Object.entries(channels as Record<string, DataPoint[]>).flatMap(([channel, peaks]) =>
  //     (peaks as DataPoint[]).map((point, i) => {
  //       const prevX = (peaks as DataPoint[])[i - 1]?.x ?? point.x;
  //       const nextX = (peaks as DataPoint[])[i + 1]?.x ?? point.x;
  //       const bandChannels = ((preprocessedData as unknown) as Record<string, Record<string, number[]>>)?.[trackKey];
  //       const bandDataArr = bandChannels?.[channel]?.map((y, x) => ({ x, y })) || [];
  //       const area = computePeakArea(bandDataArr, point.x, areaWindow);
  //       return {
  //         track: parseInt(trackKey) || 0,
  //         channels: channel,
  //         startHRF: prevX,
  //         endHRF: nextX,
  //         hRF: point.x,
  //         height: point.y.toFixed(4),
  //         area: area.toFixed(4),
  //         quantity: quantityMetric === 'height' ? point.y.toFixed(4) : area.toFixed(4)
  //       };
  //     })
  //   )
  // );
}, [quantityMetric, apiPeaksResponse, apiChartPeaks]);

// Optional: filter with `filter` input
const filteredPeaks = useMemo(() => 
  allPeaksForTable.filter((row) =>
    Object.values(row).some((value) =>
      value.toString().toLowerCase().includes(filter.toLowerCase())
    )
  ),
  [allPeaksForTable, filter]
);

console.log('filteredPeaks',
  allPeaksRef.current
);



// ...existing code...
const resultStandards = useMemo(() => {
  console.log(selectedPeak, '++++++++++++++++++++++');
  if (!selectedPeak) return [];
  const result = isPeakInAllTracks(allPeaksOverAllData, selectedPeak, 100);
  return Array.isArray(result) ? result : [];
}, [allPeaksOverAllData, selectedPeak]);
// ...existing code...
    
console.log('resultStandards',resultStandards);

 // ...existing code...


// Find closest peak from API peaks
function getClosestApiPeak(
  peaks: ChartPeak[] | undefined,
  targetX: number
): ChartPeak | null {
  if (!Array.isArray(peaks) || peaks.length === 0 || !Number.isFinite(targetX)) return null;
  let best = peaks[0];
  let bestDiff = Math.abs(best.x - targetX);
  for (let i = 1; i < peaks.length; i++) {
    const d = Math.abs(peaks[i].x - targetX);
    if (d < bestDiff) {
      best = peaks[i];
      bestDiff = d;
    }
  }
  return best;
}

function getClosestPeakY(
  peaks: { x: number; y: number }[] | undefined,
  targetX: number
): number {
  if (!Array.isArray(peaks) || peaks.length === 0 || !Number.isFinite(targetX)) return 0;
  let best = peaks[0];
  let bestDiff = Math.abs(best.x - targetX);
  for (let i = 1; i < peaks.length; i++) {
    const d = Math.abs(peaks[i].x - targetX);
    if (d < bestDiff) {
      best = peaks[i];
      bestDiff = d;
    }
  }
  return Number.isFinite(best.y) ? best.y : 0;
}

// Recompute quantity values for each track depending on the metric selection - API only
const recalcQuantityValues = useCallback(() => {
  if (!selectedPeak) return;
  const targetX = selectedPeak.peak?.x;
  const ch = selectedPeak.channel;
  console.log(`[recalcQuantityValues] Computing for channel: ${ch}, targetX: ${targetX}, metric: ${quantityMetric}, useApi: ${!!apiPeaksResponse}`);
  const next: Record<number, number> = {};
  
  for (let i = 0; i < totalTracks; i++) {
    const bandKey = String(i + 1);
    
    // Use API peaks only
    if (apiPeaksResponse && apiChartPeaks[bandKey]) {
      const apiPeaksForChannel = apiChartPeaks[bandKey][ch as keyof typeof apiChartPeaks[typeof bandKey]];
      const closestApiPeak = getClosestApiPeak(apiPeaksForChannel, targetX);
      
      if (closestApiPeak) {
        if (quantityMetric === 'height') {
          next[i] = closestApiPeak.y;
        } else {
          // Use region area if manually set, otherwise use API area
          const regionArea = regionAreasByTrack[i]?.[ch];
          next[i] = (regionArea !== undefined && regionArea > 0) ? regionArea : closestApiPeak.area;
        }
      } else {
        next[i] = 0; // No matching API peak found
      }
    } else {
      next[i] = 0; // No API data available
    }
    
    // COMMENTED OUT: Fallback to client-side calculation - using API only
    // if (quantityMetric === 'height') {
    //   const peaks = (allPeaksOverAllData as any)?.[bandKey]?.[ch] as { x: number; y: number }[] | undefined;
    //   next[i] = getClosestPeakY(peaks, targetX);
    // } else {
    //   const regionArea = regionAreasByTrack[i]?.[ch];
    //   if (regionArea !== undefined && regionArea > 0) {
    //     next[i] = regionArea;
    //   } else {
    //     const series = (preprocessedData as any)?.[bandKey]?.[ch] as number[] | undefined;
    //     const bandDataArr = series?.map((y: number, x: number) => ({ x, y })) ?? [];
    //     next[i] = computePeakArea(bandDataArr, Math.round(targetX), areaWindow);
    //   }
    // }
  }
  console.log('[recalcQuantityValues] Computed values:', next);
  setQuantityValues(next);
}, [selectedPeak, totalTracks, quantityMetric, regionAreasByTrack, apiPeaksResponse, apiChartPeaks]);


 useEffect(() => {
  if (!selectedPeak) {
    console.log('[useEffect] No selectedPeak, skipping recalc');
    return;
  }
  console.log('[useEffect] Recalculating quantity values for selectedPeak:', selectedPeak);
  recalcQuantityValues();
}, [selectedPeak, allPeaksOverAllData, preprocessedData, totalTracks, quantityMetric, areaWindow, recalcQuantityValues, regionAreasByTrack]);

// ...existing code...

const handleQuantityChange = (trackIndex: number, value: string) => {
  setAutoPeakValues((prev) => ({
    ...prev,
    [trackIndex]: parseFloat(value),
    
  }));
console.log('autoPeakValues', autoPeakValues);
};


 

    // ...existing code...
const toggleStandard = (track: string) => {
  setSelectedStandards((prev) => ({
    ...prev,
    [track]: !prev[track],
  }));
};

const toggleTrackToCalibrate = (track: string) => {
  setTracksToCalibrate((prev) => {
    const current = Object.prototype.hasOwnProperty.call(prev, track) ? prev[track] : true;
    return {
      ...prev,
      [track]: !current,
    };
  });
};
// ...existing code...
const togglePreprocessing = (value: PreprocessValue) => {
  setSelectedPreprocessing(prev =>
    prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
  );
};

//     const handleInputChange = (section, field, value) => {
//   setAdvancedOptions((prev) => ({
//     ...prev,
//     [section]: {
//       ...prev[section],
//       [field]: value,
//     },
//   }));
// };

// const handleSaveAdvancedOptions = () => {
//   console.log('Advanced Options Saved:', advancedOptions);

//   const dialog = document.getElementById('advanced_modal') as HTMLDialogElement | null;
//   dialog?.close(); // OK now
// };



const selectedTracks = Object.keys(selectedStandards).filter((key) => selectedStandards[key]);
console.log('selectedTracks--------',selectedTracks);

 // Correct mapping for known_conc and known_peaks
const known_conc = selectedTracks.map((trackKey) => {
  // Extract the track index from "band-2" => 2
  const idx = parseInt(trackKey.replace("band-", ""), 10);
  return quantityValues[idx];
});

const known_peaks = selectedTracks
  .map((trackKey) => {
    const idx = parseInt(trackKey.replace("band-", ""), 10);
    const v = quantityValues[idx];
    return Number.isFinite(v) ? v : null;
  })
  .filter((v): v is number => v !== null);

  const allTrackIndices = Array.from({ length: totalTracks }, (_, i) => i);
  const unknownIndices = allTrackIndices.filter(
    (i) => !selectedTracks.includes(`band-${i}`) && (tracksToCalibrate[`band-${i}`] ?? true)
  );
  
  // Build aligned pairs and type-narrow to numbers
  const unknownPairs = unknownIndices
    .map((i) => {
      const y = resultStandards.find((s) => s.band === i + 1)?.peak?.y ?? null;
      return { idx: i, y };
    })
    .filter((p): p is { idx: number; y: number } => typeof p.y === "number" && Number.isFinite(p.y));
  
  const unknownIndexList = unknownPairs.map((p) => p.idx);
  const unknown_peaks: number[] = unknownPairs.map((p) => p.y);
  
  console.log('unknown_peaks', unknown_peaks);
  console.log('known_conc', known_conc);
  console.log('known_peaks', known_peaks);
  
// ...existing code...
// ...existing code...
// const handleSaveSelectedTracks = async () => {
//   // Derive selected standard keys fresh
//   const selectedKeys = Object.keys(selectedStandards).filter((key) => selectedStandards[key]);
//   if (selectedKeys.length === 0) {
//     console.warn("No standards selected. Please select at least one standard.");
//     return;
//   }

//   // Require an explicitly selected peak; do not fallback
//   if (!selectedPeak) {
//     console.warn("No peak selected. Please pick a peak first.");
//     return;
//   }

//   console.log("selectedPeak", selectedPeak);

//   // Always use the latest user-selected peak
//   const matches = isPeakInAllTracks(allPeaksOverAllData, selectedPeak, 100);
//   console.log("Cross-track matches:", matches);

//   const standards = Array.isArray(matches) ? matches : [];
//   if (standards.length === 0) {
//     console.warn("No matching peaks across tracks. Adjust selection or parameters.");
//     return;
//   }

//   const getIdx = (key: string) => parseInt(key.replace("band-", ""), 10);

//   // known concentrations for selected standards
//   const known_conc_local = selectedKeys
//   .map((k) => autoPeakValues[getIdx(k)])
//   .filter((v): v is number => Number.isFinite(v));

//   // known peak heights for selected standards (map by band)
//   const known_peaks_local = selectedKeys
//   .map((k) => quantityValues[getIdx(k)])
//   .filter((v): v is number => Number.isFinite(v));

//   // unknown peaks = remaining tracks
//   const allIdx = Array.from({ length: totalTracks }, (_, i) => i);
//   const unknownIdx = allIdx.filter((i) => !selectedKeys.includes(`band-${i}`));
//   const unknown_peaks_local = unknownIdx
//     .map((i) => quantityValues[i])
//     .filter((v): v is number => Number.isFinite(v));

//   if (known_conc_local.length === 0 || known_peaks_local.length === 0) {
//     console.warn("Known concentrations or peaks are empty. Set quantities and select valid standards.");
//     return;
//   }

//   const model_type = "hill";
//   const payload = {
//     known_conc: known_conc_local,
//     known_peaks: known_peaks_local,
//     unknown_peaks: unknown_peaks_local,
//     model_type,
//   };

//   try {
//     const { data } = await axios.post(
//       "http://127.0.0.1:8000/api/calibrate/",
//       payload,
//       {
//         headers: { "Content-Type": "application/json" },
//         timeout: 15000,
//       }
//     );
//     setCalibrationResult(data);
//     console.log("API response:", data);
//   } catch (error) {
//     console.error("API error:", error);
//   }
// };
// ...existing code...

const handlePlotClick = () => {
    console.log(peakRef.current);
    setStandardData(peakRef.current);
    setShowCurve(true);
  };



const handleFinishEdit = () => {
  // Send all temp data to Redux
  // Object.entries(tempPeaks).forEach(([channel, peaks]) => {
  //   dispatch({ type: "PEAKS_BY_CHANNEL", payload: { channel, peaks } });
  // });
  // Object.entries(tempRegions).forEach(([channel, regions]) => {
  //   dispatch({ type: "REGIONS_BY_CHANNEL", payload: { channel, regions } });
  // });
  // Object.entries(tempSelectedPeak).forEach(([channel, peak]) => {
  //   dispatch({ type: "SELECTED_PEAK_BY_CHANNEL", payload: { channel, peak } });
  // });
  console.log("handlefinishedit");
  
};
const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    // Keep raw input (including empty string) so typing/backspacing feels natural.
    setFormData((prev: QuantFormData) => ({
      ...prev,
      [name]: value,
    }) as QuantFormData);
  };
const validateForm = () => {
        const errors: { [key: string]: string } = {};
      
        // if (images.length === 0) {
        //   errors.image = "Please select at least one image.";
        // }
      
        const numericKeys: (keyof QuantFormData)[] = [
          "real_width_mm",
          "real_height_mm",
          "crop_bottom_mm",
          "crop_top_mm",
          "first_band_mm",
          "band_spacing_mm",
          "num_bands",
          "estimated_band_width_mm",
        ];

        for (const key of numericKeys) {
          const raw = String(formData[key] ?? "").trim();

          if (raw === "") {
            errors[key] = "This field is required.";
            continue;
          }

          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) {
            errors[key] = "Must be a valid number.";
            continue;
          }

          if (parsed < 0) {
            errors[key] = "Value must be non-negative.";
            continue;
          }

          if (key === "num_bands" && parsed < 1) {
            errors[key] = "Must be at least 1.";
            continue;
          }
        }
      
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
      };
const handleQuantTLC = async (e: React.FormEvent<HTMLFormElement>) => {
    // Prevent default form submission
    e.preventDefault();
    if (!validateForm()) return;
  
    // Try to get the image from localStorage first; if missing, fallback to URL param.
    let file: File | null = null;
    const currentIndex = 0;
    const imageData = localStorage.getItem(`chromatogram_image_${currentIndex}`);

    if (imageData) {
      const byteString = atob(imageData.split(',')[1]);
      const mimeString = imageData.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeString });
      file = new File([blob], `image_${currentIndex}.jpg`, { type: mimeString });
    } else {
      // Fallback: fetch the image by URL if provided in the query string
      const urlFromQuery = searchParams.get("image");
      if (urlFromQuery) {
        try {
          const resp = await fetch(urlFromQuery);
          const blob = await resp.blob();
          const mime = blob.type || 'image/png';
          file = new File([blob], `image_${currentIndex}.png`, { type: mime });
        } catch (err) {
          console.error('Failed to fetch image from URL for Apply:', err);
          notify('error', 'Unable to load image for processing.');
          return;
        }
      } else {
        console.error('No image found in localStorage or URL');
        notify('error', 'No image available to process.');
        return;
      }
    }

    // Create FormData and append file
    const uploadFormData = new FormData();
    if (file) uploadFormData.append('image', file);
  
    // Append other form data
    (Object.keys(formData) as Array<keyof QuantFormData>).forEach((key) => {
      uploadFormData.append(String(key), formData[key]);
    });
  
    try {
        const resultAction = await dispatch(fetchBandData(uploadFormData));

        if (fetchBandData.rejected.match(resultAction)) {
          const msg =
            extractApiErrorPayloadMessage((resultAction as any).payload) ||
            (resultAction as any).error?.message ||
            'Request failed.';
          notify('error', `Upload failed: ${msg}`);
          return;
        }

        notify('success', 'Image processed successfully.');
        console.log("response in quant for new update");
        
  
        // if (response) {
        //     // Update marked image URL from response
        //     const fullImageUrl = apiUrl(String(response.image_url ?? ""));
        //     const markedImg = document.querySelector('img[alt="quanTLC Image"]') as HTMLImageElement;
        //     if (markedImg) {
        //         markedImg.src = fullImageUrl;
        //     }
            
        // }
    } catch (error) {
      console.error('Error uploading image:', error);
      notify('error', `Upload failed: ${getApiErrorMessage(error)}`);
    }
};
const handleDownloadReport = async () => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const accentColor: [number, number, number] = [41, 128, 185]; // Professional Blue
  let y = margin;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      drawHeader();
    }
  };

  // Draw a compact multi-channel densitogram chart directly into the PDF.
  // This avoids screenshotting DOM/Recharts and keeps export self-contained.
  const drawDensitogramChart = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    channels: Array<{ values: number[]; color: [number, number, number] }>
  ) => {
    const leftPad = 10;
    const rightPad = 2;
    const topPad = 2;
    // Extra bottom padding so X tick labels and the axis label don't overlap
    const bottomPad = 14;
    const plotX0 = x0 + leftPad;
    const plotY0 = y0 + topPad;
    const plotW = Math.max(1, w - leftPad - rightPad);
    const plotH = Math.max(1, h - topPad - bottomPad);

    // Frame
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.rect(x0, y0, w, h);

    // Determine x-length (use max across channels)
    const n = Math.max(...channels.map((c) => (Array.isArray(c.values) ? c.values.length : 0)));
    if (!Number.isFinite(n) || n <= 1) return;

    // Determine y-range across all channels
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ch of channels) {
      for (const v of ch.values) {
        if (!Number.isFinite(v)) continue;
        if (v < minY) minY = v;
        if (v > maxY) maxY = v;
      }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return;
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }

    // Light axes
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(plotX0, plotY0 + plotH, plotX0 + plotW, plotY0 + plotH);
    doc.line(plotX0, plotY0, plotX0, plotY0 + plotH);

    const step = Math.max(1, Math.ceil(n / 300)); // downsample for PDF size/speed
    const toX = (i: number) => plotX0 + (i / (n - 1)) * plotW;
    const toY = (v: number) => {
      const t = (v - minY) / (maxY - minY);
      return plotY0 + plotH - t * plotH;
    };

    // Axis tick labels (compact)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(90, 90, 90);

    const fmt = (v: number) => {
      if (!Number.isFinite(v)) return '';
      const av = Math.abs(v);
      if (av >= 1000) return v.toFixed(0);
      if (av >= 10) return v.toFixed(1);
      return v.toFixed(2);
    };

    // Y ticks: min/mid/max
    const yTicks = [minY, (minY + maxY) / 2, maxY];
    for (const tv of yTicks) {
      const ty = toY(tv);
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.15);
      doc.line(plotX0, ty, plotX0 + plotW, ty);
      doc.setTextColor(90, 90, 90);
      doc.text(fmt(tv), x0 + 1, ty + 1.5);
    }

    // X ticks: prefer 0 / mid / max, but avoid overlapping labels on narrow charts
    const xTickCandidates = [
      { i: 0, label: '0' },
      { i: Math.floor((n - 1) / 2), label: String(Math.floor((n - 1) / 2)) },
      { i: n - 1, label: String(n - 1) },
    ]
      .filter((t, idx, arr) => arr.findIndex((u) => u.i === t.i) === idx)
      .sort((a, b) => a.i - b.i);

    const minLabelGapPx = 16; // tuned for fontSize=6
    const selectedXTicks: Array<{ i: number; label: string; x: number }> = [];
    for (const t of xTickCandidates) {
      const tx = toX(t.i);
      const prev = selectedXTicks[selectedXTicks.length - 1];
      if (!prev || Math.abs(tx - prev.x) >= minLabelGapPx) {
        selectedXTicks.push({ ...t, x: tx });
      }
    }

    const xTickLabelY = y0 + h - 7;
    for (const t of selectedXTicks) {
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.15);
      doc.line(t.x, plotY0, t.x, plotY0 + plotH);
      doc.setTextColor(90, 90, 90);
      try {
        (doc as any).text(t.label, t.x, xTickLabelY, { align: 'center' });
      } catch {
        doc.text(t.label, t.x - 2, xTickLabelY);
      }
    }

    // Axis labels
    doc.setTextColor(70, 70, 70);
    doc.setFontSize(7);
    // Put the X label at bottom-right to avoid colliding with mid tick labels (e.g. 40)
    const xAxisLabelY = y0 + h - 2;
    try {
      (doc as any).text('hRF', x0 + w - 2, xAxisLabelY, { align: 'right' });
    } catch {
      doc.text('hRF', x0 + w - 10, xAxisLabelY);
    }
    // Rotated Y label (fallback to horizontal if rotation options not supported)
    try {
      (doc as any).text('Pixel Intensity (AU)', x0 + 2, plotY0 + plotH / 2 + 10, { angle: 90 });
    } catch {
      doc.text('Pixel Intensity (AU)', x0 + 1, plotY0 + 6);
    }

    for (const ch of channels) {
      const vals = ch.values;
      if (!Array.isArray(vals) || vals.length <= 1) continue;

      doc.setDrawColor(ch.color[0], ch.color[1], ch.color[2]);
      doc.setLineWidth(0.35);

      let prevX: number | null = null;
      let prevY: number | null = null;

      for (let i = 0; i < n; i += step) {
        const v = vals[i] ?? 0;
        const x = toX(i);
        const y = toY(Number.isFinite(v) ? v : 0);
        if (prevX !== null && prevY !== null) {
          doc.line(prevX, prevY, x, y);
        }
        prevX = x;
        prevY = y;
      }
    }
  };

  // --- Helper: Header Bar ---
  const drawHeader = () => {
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 0, pageWidth, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("quanTLC ANALYSIS REPORT", margin, 17);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin - 40, 17);
    y = 35;
  };

  // --- Helper: Section Title ---
  const addSectionHeader = (title: string) => {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text(title.toUpperCase(), margin, y);
    doc.setLineWidth(0.5);
    doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.line(margin, y + 2, pageWidth - margin, y + 2);
    y += 10;
  };

  drawHeader();

  // --- SECTION 1: OVERVIEW & IMAGES ---
  addSectionHeader("Step 1: Experiment Overview");
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Total Tracks: ${totalTracks}`, margin, y);
  doc.text(`Reference Track: ${bandStep}`, margin + 60, y);

  const calibrationChannelLabel = selectedPeak?.channel ? String(selectedPeak.channel) : "-";
  doc.text(`Calibration Channel: ${calibrationChannelLabel}`, margin + 120, y);
  y += 10;

  // Plate/track form settings (2-column table)
  const formatFormVal = (v: unknown) => {
    if (v === null || v === undefined) return "-";
    const s = String(v).trim();
    return s === "" ? "-" : s;
  };

  const formRows = [
    ["Plate Length (mm)", formatFormVal((formData as any)?.real_width_mm)],
    ["Plate Width (mm)", formatFormVal((formData as any)?.real_height_mm)],
    ["Distance to Lower Edge", formatFormVal((formData as any)?.crop_bottom_mm)],
    ["Migration Front (mm)", formatFormVal((formData as any)?.crop_top_mm)],
    ["First Application (mm)", formatFormVal((formData as any)?.first_band_mm)],
    ["Track Spacing (mm)", formatFormVal((formData as any)?.band_spacing_mm)],
    ["Number of Bands", formatFormVal((formData as any)?.num_bands)],
    ["Band Width (mm)", formatFormVal((formData as any)?.estimated_band_width_mm)],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Parameter", "Value"]],
    body: formRows,
    theme: "striped",
    headStyles: { fillColor: accentColor },
    styles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: pageWidth - margin * 2 - 80 },
    },
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable.finalY + 12;

  // Images Row
  const imgWidth = (pageWidth - (margin * 3)) / 2;
  const imgHeight = 50;

  if (markedImg) {
    doc.addImage(markedImg, "JPEG", margin, y, imgWidth, imgHeight);
    doc.setFontSize(8);
    doc.text("Marked TLC Plate", margin, y + imgHeight + 5);
  }
  if (imgSrc) {
    doc.addImage(imgSrc, "JPEG", margin + imgWidth + 5, y, imgWidth, imgHeight);
    doc.text("Densitogram Analysis", margin + imgWidth + 5, y + imgHeight + 5);
  }
  y += imgHeight + 15;

  // --- SECTION 2: PREPROCESSING ---
  addSectionHeader("Step 2: Preprocessing Configuration");
  const prep = selectedPreprocessing.length > 0 ? selectedPreprocessing.join(", ") : "Standard (None)";
  doc.setFont("helvetica", "italic");
  doc.text(`Applied Filters: ${prep}`, margin, y);
  y += 10;

  // Advanced options summary (only chosen params)
  const buildAdvancedSummaryLines = () => {
    const lines: string[] = [];

    // Smoothing
    const smoothing = advancedOptions?.smoothing ?? { windowSize: '', polynomialOrder: '', differentiationOrder: '' };
    const smoothingParts: string[] = [];
    if (String(smoothing.windowSize ?? '').trim() !== '') smoothingParts.push(`window.size=${String(smoothing.windowSize).trim()}`);
    if (String(smoothing.polynomialOrder ?? '').trim() !== '') smoothingParts.push(`poly.order=${String(smoothing.polynomialOrder).trim()}`);
    if (String(smoothing.differentiationOrder ?? '').trim() !== '') smoothingParts.push(`diff.order=${String(smoothing.differentiationOrder).trim()}`);
    if (smoothingParts.length > 0) lines.push(`Smoothing: ${smoothingParts.join(', ')}`);

    // Baseline
    const baseline = advancedOptions?.baseline ?? { type: '', params: {} as Record<string, string> };
    const baselineType = String(baseline.type ?? '').trim();
    const baselineParams = (baseline.params ?? {}) as Record<string, string>;
    const baselineParamParts = Object.entries(baselineParams)
      .map(([k, v]) => [k, String(v ?? '').trim()] as const)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${v}`);
    if (baselineType || baselineParamParts.length > 0) {
      lines.push(`Baseline: ${baselineType || 'selected'}${baselineParamParts.length ? `, ${baselineParamParts.join(', ')}` : ''}`);
    }

    // Warping
    const warping = advancedOptions?.warping ?? {
      method: '',
      referenceTrack: '',
      dtw: '',
      ptw: '',
      degree: '',
      seg_len: '',
    };
    const warpingMethod = String(warping.method ?? '').trim();
    const warpingParts: string[] = [];
    const pushIf = (label: string, value: unknown) => {
      const s = String(value ?? '').trim();
      if (s !== '') warpingParts.push(`${label}=${s}`);
    };
    pushIf('referenceTrack', warping.referenceTrack);
    pushIf('dtw', warping.dtw);
    pushIf('ptw', warping.ptw);
    pushIf('degree', warping.degree);
    pushIf('seg_len', warping.seg_len);
    if (warpingMethod || warpingParts.length > 0) {
      lines.push(`Warping: ${warpingMethod || 'selected'}${warpingParts.length ? `, ${warpingParts.join(', ')}` : ''}`);
    }

    return lines;
  };

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  const advLines = buildAdvancedSummaryLines();
  if (advLines.length > 0) {
    const wrapped = doc.splitTextToSize(`Advanced Options: ${advLines.join(' | ')}`, pageWidth - margin * 2);
    ensureSpace(wrapped.length * 5 + 6);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 5 + 4;
  } else {
    ensureSpace(10);
    doc.setFont("helvetica", "italic");
    doc.text('Advanced Options: none selected', margin, y);
    doc.setFont("helvetica", "normal");
    y += 8;
  }

  // Preprocessed densitograms for all tracks (rendered as charts, 2 columns; auto page breaks)
  ensureSpace(14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 50);
  doc.text('Preprocessed Densitograms (All Tracks)', margin, y);
  y += 8;

  const colGap = 6;
  const chartW = (pageWidth - margin * 2 - colGap) / 2;
  const chartH = 55;
  const labelH = 6;
  const rowGap = 10;

  let rowY = y;
  for (let idx = 0; idx < totalTracks; idx++) {
    const col = idx % 2;
    const isRowStart = col === 0;

    // Only check for overflow at the start of each row (since rows are fixed height)
    if (isRowStart) {
      const rowHeight = chartH + labelH + rowGap;
      if (rowY + rowHeight > pageHeight - margin) {
        doc.addPage();
        drawHeader();
        addSectionHeader('Step 2: Preprocessing Configuration (cont.)');
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(50, 50, 50);
        doc.text('Preprocessed Densitograms (All Tracks)', margin, y);
        y += 8;
        rowY = y;
      }
    }

    const x = margin + col * (chartW + colGap);
    const trackKey = String(idx + 1);
    const trackSeries: any = (preprocessedData as any)?.[trackKey];

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);

    if (trackSeries && (trackSeries.red || trackSeries.green || trackSeries.blue || trackSeries.grayscale)) {
      drawDensitogramChart(x, rowY, chartW, chartH, [
        { values: (trackSeries.red ?? []) as number[], color: [255, 0, 0] },
        { values: (trackSeries.green ?? []) as number[], color: [0, 128, 0] },
        { values: (trackSeries.blue ?? []) as number[], color: [0, 0, 255] },
        { values: (trackSeries.grayscale ?? []) as number[], color: [128, 128, 128] },
      ]);
      doc.text(`Track ${idx + 1}`, x, rowY + chartH + 5);
    } else {
      doc.setDrawColor(200, 200, 200);
      doc.rect(x, rowY, chartW, chartH);
      doc.text(`Track ${idx + 1}: no preprocessed data`, x + 2, rowY + 10);
    }

    if (col === 1) {
      rowY += chartH + labelH + rowGap;
    }
  }

  // Move y below the last rendered row
  if (totalTracks % 2 === 0) {
    y = rowY + 6;
  } else {
    y = rowY + chartH + labelH + 6;
  }

  // --- SECTION 3: STANDARDS TABLE ---
  addSectionHeader("Step 3: Track Metadata & Standards");
  const standardRows = Array.from({ length: totalTracks }).map((_, i) => [
    `Track ${i + 1}`,
    selectedStandards[`band-${i}`] ? "YES" : "NO",
    Number.isFinite(quantityValues[i]) ? Number(quantityValues[i]).toFixed(4) : "N/A"
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Track ID', 'Is Standard', 'Assigned Quantity']],
    body: standardRows,
    theme: 'striped',
    headStyles: { fillColor: accentColor },
    margin: { left: margin, right: margin }
  });
  
  y = (doc as any).lastAutoTable.finalY + 15;

  // --- SECTION 4: CALIBRATION ---
  if (y > 220) { doc.addPage(); y = 25; } // Simple page break check
  addSectionHeader("Step 4: Calibration Curve");

  // Model + metrics (best-effort: backend key names may vary)
  const cal: any = calibrationResult as any;
  const preds: any = cal?.predictions;
  const modelLabel = modelOptions.find((o) => o.value === modelType)?.label ?? String(modelType);
  const r2Raw =
    cal?.r2 ??
    cal?.R2 ??
    cal?.r_squared ??
    cal?.rSquared ??
    cal?.r_square ??
    cal?.rsq ??
    preds?.r2 ??
    preds?.R2 ??
    preds?.r_squared ??
    preds?.rSquared ??
    preds?.r_square ??
    preds?.rsq;
  const rmseRaw =
    cal?.rmse ??
    cal?.RMSE ??
    cal?.root_mean_squared_error ??
    preds?.rmse ??
    preds?.RMSE ??
    preds?.root_mean_squared_error;
  const r2 = Number(r2Raw);
  const rmse = Number(rmseRaw);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(50, 50, 50);
  doc.text(`Model: ${modelLabel}`, margin, y);
  y += 7;
  doc.text(
    `R2: ${Number.isFinite(r2) ? r2.toFixed(4) : '-'}   RMSE: ${Number.isFinite(rmse) ? rmse.toFixed(4) : '-'}`,
    margin,
    y
  );
  y += 8;
  
  if (calibrationResult?.predictions?.equation) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Equation: ${calibrationResult.predictions.equation}`, margin, y);
    y += 8;
  }

  if (calibrateImg) {
    doc.addImage(calibrateImg, "JPEG", margin, y, 100, 60);
    y += 70;
  }

  // --- SECTION 5: FINAL RESULTS ---
  addSectionHeader("Step 5: Predicted Amount (Unknowns)");
  
  if (Array.isArray(calibrationResult?.predictions?.concentrations)) {
    // Unknowns are the tracks that are NOT selected as standards.
    // Keep ordering consistent with how unknowns are built for calibration (ascending track index).
    const selectedKeysForReport = Object.keys(selectedStandards).filter((k) => selectedStandards[k]);
    const standardTrackIndicesForReport = selectedKeysForReport
      .map((k) => Number.parseInt(k.replace("band-", ""), 10))
      .filter((n) => Number.isFinite(n));
    const unknownTrackIndicesForReport = Array.from({ length: totalTracks }, (_, i) => i).filter(
      (i) => !standardTrackIndicesForReport.includes(i) && (tracksToCalibrate[`band-${i}`] ?? true)
    );

    const resultRows = calibrationResult.predictions.concentrations.map((conc, idx) => {
      const trackIndex = unknownTrackIndicesForReport[idx];
      const baseIdx = Number.isFinite(trackIndex) ? (trackIndex as number) : idx;
      const trackNo = baseIdx + 1;

      const concNum = Number(conc);
      const concText = Number.isFinite(concNum) ? concNum.toFixed(4) : '-';

      return [`Track ${trackNo}`, concText];
    });

    autoTable(doc, {
      startY: y,
      head: [['Sample Source', 'Predicted Amount']],
      body: resultRows,
      theme: 'grid',
      headStyles: { fillColor: [39, 174, 96] }, // Green for results
    });
  } else {
    doc.text("No unknowns identified for prediction.", margin, y);
  }

  doc.save(`TLC_Report_${new Date().getTime()}.pdf`);
};

function getFirstPeakFromRef(
  ref: { [channel: string]: any },
  band: number
): { channel: ChannelName; band: number; peak: DataPoint } | null {
  const channels: ChannelName[] = ["red", "green", "blue", "grayscale"];
  for (const ch of channels) {
    const entry = ref[ch];
    let p: DataPoint | undefined;

    // Case 1: simple array of peaks
    if (Array.isArray(entry)) {
      p = entry[0];
    }
    // Case 2: peaks grouped per band: ref[channel][band] -> DataPoint[]
    else if (entry && typeof entry === "object") {
      const byBand = entry as Record<number | string, DataPoint[]>;
      const arr = byBand[band] || byBand[String(band)];
      if (Array.isArray(arr)) p = arr[0];
    }

    if (p) return { channel: ch, band, peak: p };
  }
  return null;
}
// ...existing code...
const handleGetSelectedPeak = () => {
  const picked = peakRef.current;
  if (!picked) {
    console.warn("No peaks found in peakRef for current band.");
    notify('warning', 'No peaks found in the current band.');
    return;
  }

  if (modelType === 'none') {
    notify('error', 'Please select a calibration model before calibrating.');
    return;
  }
  console.log("handleGetSelectedPeak", picked);

  const prev = prevSelectedPeakRef.current || {};
  const curr = picked as Record<string, any[]>;

  const prevChannels = new Set(Object.keys(prev));
  const currChannels = new Set(Object.keys(curr));

  let updatedChannel: string | null = null;

  // Log new/updated channels
  Array.from(currChannels).forEach((ch) => {
    const was = prev[ch];
    const now = curr[ch];

    if (!(ch in prev)) {
      console.log(`[selectedPeak] NEW channel "${ch}" ->`, now);
      updatedChannel = ch;
    } else if (!isSamePeakArray(was, now)) {
      console.log(`[selectedPeak] UPDATED channel "${ch}"`, { before: was, after: now });
      updatedChannel = ch;
    }
  });

  // Log cleared/removed channels
  Array.from(prevChannels).forEach((ch) => {
    if (!currChannels.has(ch)) {
      console.log(`[selectedPeak] CLEARED channel "${ch}" (was ->)`, prev[ch]);
    }
  });

  // Decide the peak to use even if there is no change
  let chosen: { channel: ChannelName; band: number; peak: DataPoint } | null = null;

  if (updatedChannel) {
    const peakArr = curr[updatedChannel] || [];
    const peak = peakArr[0] ?? null;
    if (peak) {
      chosen = { channel: updatedChannel as ChannelName, band: bandStep, peak };
      setSelectedPeak(chosen);
      console.log("Selected peak set (updated):", chosen);
    }
  } else {
    console.log("[selectedPeak] No changes detected. Using last known selection/fallback.");
    // Prefer the already selected peak, else fallback to first available from ref
    if (selectedPeak) {
      chosen = selectedPeak;
    } else {
      const fallback = getFirstPeakFromRef(peakRef.current, bandStep);
      if (fallback) {
        chosen = fallback;
        setSelectedPeak(fallback);
        console.log("Selected peak set (fallback):", fallback);
      }
    }
  }

  if (!chosen) {
    console.warn("No usable peak to calibrate.");
    notify('warning', 'No usable peak to calibrate.');
    prevSelectedPeakRef.current = clone(curr);
    return;
  }

  const selectedKeys = Object.keys(selectedStandards).filter((k) => selectedStandards[k]);
  if (selectedKeys.length === 0) {
    console.warn("No standards selected. Please select at least one standard.");
    notify('warning', 'No standards selected. Please select at least one standard.');
  } else {
    const isTrackEnabled = (trackIndex: number) => tracksToCalibrate[`band-${trackIndex}`] ?? true;

    // Get the selected standard track indices (0-based)
    const standardKeysEnabled = selectedKeys.filter((k) => {
      const idx = Number.parseInt(k.replace("band-", ""), 10);
      return Number.isFinite(idx) && isTrackEnabled(idx);
    });

    const standardTrackIndices = standardKeysEnabled
      .map((k) => Number.parseInt(k.replace("band-", ""), 10))
      .filter((n) => Number.isFinite(n));

    if (standardTrackIndices.length === 0) {
      console.warn("No enabled standards selected for calibration.");
      notify('warning', 'No enabled standards selected for calibration. Check “To calibrate?”.');
      prevSelectedPeakRef.current = clone(curr);
      return;
    }

    /**
     * Check if the selected peak is present within threshold in all selected standard tracks.
     * Only checks the same channel as the selected peak.
     * @param selectedPeak - The peak selected by the user (channel, band, peak)
     * @param standardIndices - Array of 0-based track indices for selected standards
     * @param threshold - The hRF tolerance for matching peaks
     * @returns Array of matched peaks or false if any standard track is missing the peak
     */
    const isPeakInSelectedStandards = (
      selectedPeak: { channel: ChannelName; band: number; peak: DataPoint },
      standardIndices: number[],
      threshold: number
    ): { channel: ChannelName; band: number; peak: DataPoint; area?: number }[] | false => {
      const { channel, peak } = selectedPeak;
      const targetX = peak?.x;

      console.log('[isPeakInSelectedStandards] Checking peak:', { channel, targetX, threshold, standardIndices });

      if (!Number.isFinite(targetX) || !Number.isFinite(threshold) || threshold < 0) {
        console.warn('[isPeakInSelectedStandards] Invalid targetX or threshold', { targetX, threshold });
        return false;
      }

      const matchedPeaks: { channel: ChannelName; band: number; peak: DataPoint; area?: number }[] = [];

      for (const trackIndex of standardIndices) {
        // apiPeaksResponse uses 1-based keys as strings
        const trackKey = String(trackIndex + 1);
        const trackData = apiPeaksResponse?.[trackKey];

        if (!trackData) {
          console.warn('[isPeakInSelectedStandards] No API peaks data for track', { trackIndex, trackKey });
          return false;
        }

        // Get the channel peaks object from apiPeaksResponse
        // Structure: { "50": { peak_height, peak_x, start_end, area }, "56": {...}, ... }
        const channelPeaks = trackData[channel];

        if (!channelPeaks || typeof channelPeaks !== 'object' || Object.keys(channelPeaks).length === 0) {
          console.warn('[isPeakInSelectedStandards] No peaks in channel for track', { trackIndex, channel });
          return false;
        }

        // Find the peak within threshold of targetX
        // Keys are peak_x positions as strings
        const peakEntries = Object.entries(channelPeaks);
        let matchedPeak: { x: number; y: number; area?: number } | null = null;
        let minDiff = Infinity;

        for (const [peakXStr, peakData] of peakEntries) {
          const peakX = Number(peakXStr);
          const diff = Math.abs(peakX - targetX);
          
          if (diff <= threshold && diff < minDiff) {
            minDiff = diff;
            matchedPeak = {
              x: (peakData as any).peak_x ?? peakX,
              y: (peakData as any).peak_height ?? 0,
              area: (peakData as any).area
            };
          }
        }

        if (!matchedPeak) {
          const allPeakXs = peakEntries.map(([xStr]) => Number(xStr));
          const closestDiff = Math.min(...allPeakXs.map(x => Math.abs(x - targetX)));
          console.warn('[isPeakInSelectedStandards] No peak within threshold', {
            trackIndex,
            channel,
            targetX,
            threshold,
            closestDiff,
            availablePeaks: allPeakXs
          });
          return false;
        }

        matchedPeaks.push({ 
          channel, 
          band: trackIndex, 
          peak: { x: matchedPeak.x, y: matchedPeak.y },
          area: matchedPeak.area
        });
      }

      console.log('[isPeakInSelectedStandards] All standards matched:', matchedPeaks);
      return matchedPeaks;
    };

    const matches = isPeakInSelectedStandards(chosen, standardTrackIndices, hRFRangeTolerance);
    if (!Array.isArray(matches) || matches.length === 0) {
      console.warn("No matching peaks across selected standard tracks. Adjust selection or parameters.");
      notify('warning', 'No matching peaks across selected standard tracks.');
    } else {
      const getIdx = (k: string) => parseInt(k.replace("band-", ""), 10);

      // Known concentrations + peaks must stay aligned (same ordering/length).
      // Use only standards that are enabled for calibration.
      const knownPairs = standardKeysEnabled
        .map((k) => {
          const idx = getIdx(k);
          return {
            conc: autoPeakValues[idx],
            peak: quantityValues[idx],
          };
        })
        .filter(
          (p): p is { conc: number; peak: number } =>
            Number.isFinite(p.conc) && Number.isFinite(p.peak)
        );

      const known_conc_local = knownPairs.map((p) => p.conc);
      const known_peaks_local = knownPairs.map((p) => p.peak);

      const allIdx = Array.from({ length: totalTracks }, (_, i) => i);
      // Unknowns are non-standards that are enabled for calibration.
      const unknownIdx = allIdx.filter(
        (i) => !selectedStandards[`band-${i}`] && isTrackEnabled(i)
      );

      // Unknown peaks: use quantityValues (area or height based on metric) for non-standard tracks
      const unknown_peaks_local = unknownIdx
        .map((i) => quantityValues[i])
        .filter((v): v is number => Number.isFinite(v));

      console.log('=== CALIBRATION DATA ===');
      console.log('Selected Standards Keys:', selectedKeys);
      console.log('autoPeakValues (user-entered concentrations):', autoPeakValues);
      console.log('quantityValues (peak metric - height or area):', quantityValues);
      console.log('Current quantityMetric:', quantityMetric);

      const payload = {
        known_conc: known_conc_local,
        known_peaks: known_peaks_local,
        unknown_peaks: unknown_peaks_local,
        model_type: modelType,
      };

      // Log calibration data for debugging
      console.log('Calibration Payload:', {
        quantityMetric,
        known_conc: known_conc_local,
        known_peaks: known_peaks_local,
        unknown_peaks: unknown_peaks_local,
        model_type: modelType
      });

      // Always hit the API, even if arrays are empty (backend should validate)
      (async () => {
        setCalibrationLoading(true);
        try {
          const response = await axios.post(
            apiUrl("/calibrate/"),
            payload,
            { headers: { "Content-Type": "application/json" }, timeout: 15000 }
          );

          if (response.status !== 200) {
            throw new Error(formatNon200AxiosResponse({
              status: response.status,
              statusText: response.statusText,
              data: response.data,
            }));
          }

          setCalibrationResult(response.data);
          console.log("Calibrate API response:", response.data);
          notify('success', 'Calibration completed.');
        } catch (err: unknown) {
          console.error("Calibrate API error:", err);
          notify('error', `Calibration failed: ${getApiErrorMessage(err)}`);
        } finally {
          setCalibrationLoading(false);
        }
      })();
    }
  }


  // Save snapshot
  prevSelectedPeakRef.current = clone(curr);
};
// ...existing code...

console.log('calibrationResult',calibrationResult); 


const openSelectStandardModal = () => {
  if (!preprocessedData) {
    notify('warning', 'Preprocessed data not available.');
    return;
  }

  // Prefer existing selectedPeak; otherwise infer one from peakRef for the current band
  let chosen = selectedPeak ?? getFirstPeakFromRef(peakRef.current, bandStep);

  if (!chosen) {
    notify('warning', 'Pick a peak on any chart first.');
    (document.getElementById("select_standard_modal") as HTMLDialogElement | null)?.showModal();
    return;
  }

  // Persist the chosen peak so the header and other UI can use it
  setSelectedPeak(chosen);

  // Populate quantityValues from detected peaks (closest by x in selected channel)
  // Recalculate quantities using current metric selection
  recalcQuantityValues();

  (document.getElementById("select_standard_modal") as HTMLDialogElement | null)?.showModal();
};

    return (
        <div className="flex flex-col items-center mt-6 w-full">
           {/* Alerts */}
           {uiAlert && (
             <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[min(90vw,48rem)] px-4">
               <div
                 role="alert"
                 aria-live="assertive"
                 className={`alert ${
                   uiAlert.type === 'warning' ? 'alert-warning' : uiAlert.type === 'error' ? 'alert-error' : 'alert-success'
                 } shadow-lg`}
               >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                     d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                 </svg>
                 <span>{uiAlert.message}</span>
                 <button className="btn btn-sm ml-auto" onClick={() => setUiAlert(null)}>Dismiss</button>
               </div>
             </div>
           )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <span className="loading loading-spinner loading-lg"></span>
                <p className="mt-2 text-gray-600">Loading…</p>
              </div>
            ) : (
              <>
                {!bandData && (
                  <div className="alert alert-error shadow-sm mb-4 w-[min(90vw,48rem)]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>No densitogram data loaded. Please correct values and click Apply.</span>
                  </div>
                )}
                <h1 className="text-2xl font-bold mb-4">quanTLC</h1>

            {/* Step Indicator */}
            <ul className="steps steps-vertical lg:steps-horizontal w-full max-w-3xl mb-6">
                <li className={`step ${step >= 1 ? "step-primary" : ""}`}>Preprocessing</li>
                <li className={`step ${step >= 2 ? "step-primary" : ""}`}>Integration & Stats</li>
                <li className={`step ${step >= 3 ? "step-primary" : ""}`}>Report</li>
            </ul>

           {/* Step 1: Preprocessing */}
{step === 1 && (
    <div className="w-full max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">Step 1: Preprocessing</h2>

        {/* Display Image with Arrows */}
       {markedImg && (
        <>
    <div className="mt-4 flex items-center justify-center gap-4">

        {/* Image */}
        <img
            src={markedImg}
            alt="quanTLC Image"
            className="w-full h-[200px] max-w-2xl rounded-lg shadow-lg"
            />
    </div>

     {/* Number of Tracks Input */}
       <div className="mt-4 flex flex-col items-center justify-center gap-2">
  {/* Step Number */}
  <p className="text-sm text-gray-600">
    Track {bandStep} of {totalTracks}
  </p>

  {/* Navigation and Image */}
  <div className="flex items-center justify-center gap-4">
    {/* Left Arrow */}
    <button
      className="p-2 bg-white rounded-full shadow hover:bg-gray-100"
      onClick={() => {
        if (bandStep > 1) setBandStep(bandStep - 1);
      }}
      disabled={bandStep <= 1}
    >
      <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
    </button>

    {/* Image */}
    {data && (
      <img
      src={imgSrc}
        alt="quanTLC band Image"
        className="w-full max-w-lg rounded-lg shadow-lg"
      />
    )}

    {/* Right Arrow */}
    <button
      className="p-2 bg-white rounded-full shadow hover:bg-gray-100"
      onClick={() => {
        if (bandStep < totalTracks) setBandStep(bandStep + 1);
      }}
      disabled={bandStep >= totalTracks}
    >
      <ArrowRightIcon className="h-6 w-6 text-gray-600" />
    </button>
  </div>
</div>
              </>
            )}
{/* Compact Form Section */}
<form className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-sm w-full max-w-5xl" onSubmit={handleQuantTLC}>
  {(
    [
      { label: "Plate Length (mm)", name: "real_width_mm" },
      { label: "Plate Width (mm)", name: "real_height_mm" },
      { label: "Distance to Lower Edge", name: "crop_bottom_mm" },
      { label: "Migration Front (mm)", name: "crop_top_mm" },
      { label: "First Application (mm)", name: "first_band_mm" },
      { label: "Track Spacing (mm)", name: "band_spacing_mm" },
      { label: "Number of Bands", name: "num_bands" },
      { label: "Band Width (mm)", name: "estimated_band_width_mm" },
    ] as const
  ).map((field) => (
    <div key={field.name} className="flex flex-col">
      <label className="text-xs font-medium mb-1 text-gray-600">{field.label}</label>
      <input
        type="number"
        name={field.name}
        value={formData[field.name]}
        min="0"
        step="0.01"
        onChange={handleInputChange}
        className={`input input-bordered input-sm w-full ${formErrors[field.name] ? 'input-error' : ''}`}
      />
      {formErrors[field.name] && (
        <span className="mt-1 text-xs text-error">{formErrors[field.name]}</span>
      )}
    </div>
  ))}
  {/* Submit Button */}
  <div className="flex flex-col">
    <button
      type="submit"
      className="btn btn-primary btn-sm mt-5 w-full"
    >
      Apply
    </button>
  </div>
</form>


        {/* Preprocessing Options */}
        <div className="mb-4 mt-4">
  <label className="block text-lg font-medium">Select Preprocessing Steps</label>
  <div className="flex flex-wrap justify-center items-center space-x-4 mt-4">

    
  {preprocessingOptions.map((opt) => (
        <label key={opt.value} className="flex items-center space-x-2 mb-2">
          <input
            type="checkbox"
            className="checkbox"
            value={opt.value}
            checked={selectedPreprocessing.includes(opt.value)}
            onChange={() => togglePreprocessing(opt.value)}
          />
          <span>{opt.label}</span>
        </label>
      ))}


<button
        className="btn btn-outline btn-sm mb-2"
        onClick={() =>
          (document.getElementById('advanced_modal') as HTMLDialogElement | null)?.showModal()
        }
      >
        Advanced Preprocessing
      </button>
</div>


  {/* Button to trigger modal */}
 

  {/* Modal */}
  <dialog id="advanced_modal" className="modal">
  <div className="modal-box max-w-3xl">
    <form method="dialog">
      <button className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
    </form>
    <h3 className="font-bold text-lg mb-4">Advanced Preprocessing Options</h3>

    {/* Smoothing Section */}
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <h4 className="font-semibold">Smoothing</h4>
        <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP.Smoothing)} direction="bottom" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">window.size</span>
            <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP.Smoothing, 'window.size')} direction="bottom" />
          </div>
          <input
            type="number"
            placeholder="Size of window"
            className="input input-bordered w-full"
            value={advancedOptions.smoothing.windowSize}
            onChange={(e) =>
              setAdvancedOptions(prev => ({
                ...prev,
                smoothing: { ...prev.smoothing, windowSize: e.target.value }
              }))
            }
          />
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">poly.order</span>
            <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP.Smoothing, 'poly.order')} direction="bottom" />
          </div>
          <input
            type="number"
            placeholder="Polynomial order"
            className="input input-bordered w-full"
            value={advancedOptions.smoothing.polynomialOrder}
            onChange={(e) =>
              setAdvancedOptions(prev => ({
                ...prev,
                smoothing: { ...prev.smoothing, polynomialOrder: e.target.value }
              }))
            }
          />
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">diff.order</span>
            <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP.Smoothing, 'diff.order')} direction="bottom" />
          </div>
          <input
            type="number"
            placeholder="Differentiation order"
            className="input input-bordered w-full"
            value={advancedOptions.smoothing.differentiationOrder}
            onChange={(e) =>
              setAdvancedOptions(prev => ({
                ...prev,
                smoothing: { ...prev.smoothing, differentiationOrder: e.target.value }
              }))
            }
          />
        </div>
      </div>
    </div>

    {/* Baseline Section */}
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <h4 className="font-semibold">Baseline</h4>
        <InfoTip
          tip={
            advancedOptions.baseline.type
              ? formatHelpTip(
                  (ADVANCED_PREPROCESS_HELP as any)[`Baseline.${advancedOptions.baseline.type}`] as HelpEntry | undefined
                )
              : "Pick a baseline type to see parameter help."
          }
          direction="bottom"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-2">
        <select
          className="select select-bordered w-full"
          value={advancedOptions.baseline.type}
          onChange={(e) => handleBaselineTypeChange(e.target.value)}
        >
          <option value="">Select baseline type</option>
          {baselineTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* <input
          type="text"
          className="input input-bordered w-full"
          value={advancedOptions.baseline.type ? `${advancedOptions.baseline.type} parameters` : ""}
          readOnly
          placeholder="Baseline parameters"
        /> */}
      </div>

      {!!advancedOptions.baseline.type && (
        <div className="grid grid-cols-2 gap-4 mt-2">
          {Object.entries((advancedOptions.baseline as any).params ?? {}).map(([key, val]) => {
            const entry = (ADVANCED_PREPROCESS_HELP as any)[`Baseline.${advancedOptions.baseline.type}`] as HelpEntry | undefined;
            const tip = entry?.parameters?.[String(key)]
              ? formatHelpTip(entry, String(key))
              : entry
                ? `${entry.purpose} • Param: ${String(key)}`
                : `Param: ${String(key)}`;

            return (
              <div key={key} className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700">{String(key)}</span>
                  <InfoTip tip={tip} direction="bottom" />
                </div>
                <input
                  type="text"
                  placeholder={String(key)}
                  className="input input-bordered w-full"
                  value={val as number}
                  onChange={(e) => handleBaselineParamChange(String(key), e.target.value)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>

    {/* Warping Section */}
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <h4 className="font-semibold">Warping</h4>
        <InfoTip
          tip={
            advancedOptions.warping.method === 'DTW'
              ? formatHelpTip(ADVANCED_PREPROCESS_HELP['Warping.DTW'])
              : advancedOptions.warping.method === 'PTW'
                ? formatHelpTip(ADVANCED_PREPROCESS_HELP['Warping.PTW'])
                : 'Select DTW or PTW to see parameter help.'
          }
          direction="bottom"
        />
      </div>
      <div className="grid grid-cols-2 gap-4 mt-2">
        {/* Warping method dropdown */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">Method</span>
            <InfoTip tip={"DTW aligns by minimizing distance; PTW fits a polynomial time map to a template."} direction="bottom" />
          </div>
          <select
            className="select select-bordered w-full"
            value={advancedOptions.warping.method}
            onChange={(e) => handleWarpingMethodChange(e.target.value)}
          >
            <option value="">Select warping method</option>
            <option value="DTW">DTW</option>
            <option value="PTW">PTW</option>
          </select>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">Template/Reference track</span>
            <InfoTip tip={"Index of the template (reference band) used for alignment."} direction="bottom" />
          </div>
          <input
            type="text"
            placeholder="Track of reference"
            className="input input-bordered w-full"
            value={advancedOptions.warping.referenceTrack}
            onChange={(e) =>
              setAdvancedOptions(prev => ({
                ...prev,
                warping: { ...prev.warping, referenceTrack: e.target.value }
              }))
            }
          />
        </div>

        {/* DTW-specific field */}
        {advancedOptions.warping.method === "DTW" && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-700">dtw</span>
              <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP['Warping.DTW'], 'dtw')} direction="bottom" />
            </div>
            <input
              type="number"
              placeholder="dtw (template index)"
              className="input input-bordered w-full"
              value={advancedOptions.warping.dtw ?? ""}
              onChange={(e) =>
                setAdvancedOptions(prev => ({
                  ...prev,
                  warping: { ...prev.warping, dtw: e.target.value }
                }))
              }
            />
          </div>
        )}

        {/* PTW-specific fields */}
        {advancedOptions.warping.method === "PTW" && (
          <>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-700">ptw</span>
                <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP['Warping.PTW'], 'ptw')} direction="bottom" />
              </div>
              <input
                type="number"
                placeholder="ptw (template index)"
                className="input input-bordered w-full"
                value={advancedOptions.warping.ptw ?? ""}
                onChange={(e) =>
                  setAdvancedOptions(prev => ({
                    ...prev,
                    warping: { ...prev.warping, ptw: e.target.value }
                  }))
                }
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-700">degree</span>
                <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP['Warping.PTW'], 'degree')} direction="bottom" />
              </div>
              <input
                type="number"
                placeholder="degree"
                className="input input-bordered w-full"
                value={advancedOptions.warping.degree ?? ""}
                onChange={(e) =>
                  setAdvancedOptions(prev => ({
                    ...prev,
                    warping: { ...prev.warping, degree: e.target.value }
                  }))
                }
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-700">seg_len</span>
                <InfoTip tip={formatHelpTip(ADVANCED_PREPROCESS_HELP['Warping.PTW'], 'seg_len')} direction="bottom" />
              </div>
              <input
                type="number"
                placeholder="seg_len"
                className="input input-bordered w-full"
                value={advancedOptions.warping.seg_len ?? ""}
                onChange={(e) =>
                  setAdvancedOptions(prev => ({
                    ...prev,
                    warping: { ...prev.warping, seg_len: e.target.value }
                  }))
                }
              />
            </div>
          </>
        )}
      </div>
    </div>

    {/* Modal actions */}
    <div className="modal-action">
      <form method="dialog">
        <button className="btn btn-outline">Cancel</button>
      </form>
      <button className="btn btn-primary" onClick={handleSaveAdvancedOptions}>
        Apply
      </button>
    </div>
  </div>
</dialog>


</div>


        {/* Toggle for Before/After Preprocessing */}
        {/* <div className="flex items-center mb-4">
            <label className="mr-2 text-lg font-medium">Show Processed</label>
            <input
                type="checkbox"
                className="toggle"
                checked={showProcessed}
                onChange={() => setShowProcessed(!showProcessed)}
            />
        </div> */}

        {/* Generate Densitogram Button */}
        <button
          className={`btn btn-primary w-full mb-4 ${preprocessLoading ? 'loading' : ''}`}
          // onClick={() => handlePeakDetection(data, params)}
          onClick={handlePreProcess}
          disabled={preprocessLoading}
        >
          {preprocessLoading ? <><span className="loading loading-spinner loading-sm"></span> Processing...</> : 'Apply Preprocessing'}  
        </button>
            </div>
        )}

            {/* Preprocessing Loading Spinner */}
            {preprocessLoading && step === 1 && (
              <div className="flex flex-col items-center justify-center py-12">
                <span className="loading loading-spinner loading-lg"></span>
                <p className="mt-4 text-gray-600">Preprocessing data...</p>
              </div>
            )}

            {/* Densitogram Graph */}
            {preprocessedData && step === 1 && !preprocessLoading && (
                <DensitogramGraph bandStep={bandKey} preprocessing={selectedPreprocessing} onProcessedData={handleProcessedData} densitogram={preprocessedData}/>

            )}

  {step === 2 && (
    <div className="w-full max-w-8xl mx-auto px-4">
       




        {/* Peak Detection + Peak Selection (side-by-side) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full mb-6">

        {/* Peak Integration Section - API-based */}
        <div className="p-4 border rounded-lg shadow-md w-full">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-700">Peak Integration</h2>
                <InfoTip
                  tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Peak.Integration"] as HelpEntry)}
                  direction="bottom"
                />
              </div>
              <button 
                className={`btn btn-primary btn-sm ${apiPeaksLoading ? 'loading' : ''}`}
                onClick={fetchPeaksFromApi}
                disabled={apiPeaksLoading || !preprocessedData}
              >
                {apiPeaksLoading ? 'Detecting...' : 'Detect Peaks'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Min Peak Height
                      </label>
                      <InfoTip
                        tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Peak.Integration"] as HelpEntry, 'height')}
                        direction="bottom"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded p-2"
                        placeholder="Min"
                        value={apiPeakParams.min_peak_height ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setApiPeakParams(prev => ({
                            ...prev,
                            min_peak_height: v === '' ? null : parseFloat(v),
                          }));
                        }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded p-2"
                        placeholder="Max (optional)"
                        value={maxPeakHeight ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMaxPeakHeight(v === '' ? null : parseFloat(v));
                        }}
                      />
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">
                      Leave max empty to send only min.
                    </p>
                </div>

                <div className="md:col-span-2 flex items-end justify-end">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      (document.getElementById('api_peak_advanced_modal') as HTMLDialogElement | null)?.showModal()
                    }
                  >
                    Advanced
                  </button>
                </div>
            </div>

            <dialog id="api_peak_advanced_modal" className="modal">
              <div className="modal-box max-w-3xl">
                <form method="dialog">
                  <button className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
                </form>
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="font-bold text-lg">Advanced Peak Detection (API)</h3>
                  <InfoTip
                    tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Peak.Integration"] as HelpEntry)}
                    direction="bottom"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-sm font-medium text-gray-700">Peak Prominence</label>
                      <InfoTip
                        tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Peak.Integration"] as HelpEntry, 'prominence')}
                        direction="bottom"
                      />
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border rounded p-2"
                      value={apiPeakParams.peak_prominence ?? ''}
                      onChange={(e) =>
                        setApiPeakParams(prev => ({ ...prev, peak_prominence: parseFloat(e.target.value) || 0 }))
                      }
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-sm font-medium text-gray-700">Distance Between Peaks</label>
                      <InfoTip
                        tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Peak.Integration"] as HelpEntry, 'distance')}
                        direction="bottom"
                      />
                    </div>
                    <input
                      type="number"
                      className="w-full border rounded p-2"
                      value={apiPeakParams.distance_bw_peaks ?? ''}
                      onChange={(e) =>
                        setApiPeakParams(prev => ({ ...prev, distance_bw_peaks: parseInt(e.target.value) || 1 }))
                      }
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-sm font-medium text-gray-700">Min Peak Area</label>
                      <InfoTip
                        tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Peak.Integration"] as HelpEntry, 'Min_peak_area')}
                        direction="bottom"
                      />
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      className="w-full border rounded p-2"
                      value={apiPeakParams.peak_Min_peak_area ?? ''}
                      onChange={(e) =>
                        setApiPeakParams(prev => ({ ...prev, peak_Min_peak_area: parseFloat(e.target.value) || 0 }))
                      }
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-sm font-medium text-gray-700">Peak Width</label>
                      <InfoTip
                        tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Peak.Integration"] as HelpEntry, 'width')}
                        direction="bottom"
                      />
                    </div>
                    <input
                      type="number"
                      className="w-full border rounded p-2"
                      value={apiPeakParams.peak_width ?? ''}
                      onChange={(e) =>
                        setApiPeakParams(prev => ({ ...prev, peak_width: parseInt(e.target.value) || 1 }))
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Peak Threshold</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border rounded p-2"
                      value={apiPeakParams.peak_threshold ?? ''}
                      onChange={(e) =>
                        setApiPeakParams(prev => ({ ...prev, peak_threshold: parseFloat(e.target.value) || 0 }))
                      }
                    />
                  </div>
                </div>

                <div className="modal-action">
                  <form method="dialog">
                    <button className="btn">Close</button>
                  </form>
                </div>
              </div>
            </dialog>

            {/* Status indicator */}
            {apiPeaksResponse && (
              <div className="mt-3 text-sm text-success">
                ✓ {Object.keys(apiChartPeaks).length} tracks processed with peaks detected
              </div>
            )}
        </div>

        {/* Legacy Peak Integration Section (Client-side fallback)
        <details className="collapse collapse-arrow border rounded-lg shadow-md w-full mb-6">
          <summary className="collapse-title text-sm font-medium text-gray-500">
            Advanced: Client-side Peak Detection (fallback)
          </summary>
          <div className="collapse-content p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">
                        Min Increasing Steps
                    </label>
                    <input
                        type="number"
                        className="w-full border rounded p-2"
                   
                        value={peakParams.minIncreasingSteps}
  onChange={(e) =>
    setPeakParams(prev => ({ ...prev, minIncreasingSteps: parseInt(e.target.value) }))
  }
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">
                        Min Decreasing Steps
                    </label>
                    <input
                        type="number"
                        className="w-full border rounded p-2"
                
                        onChange={(e) =>
                          setPeakParams(prev => ({ ...prev, minDecreasingSteps: parseInt(e.target.value) }))
                        }
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">
                        Min Peak Height
                    </label>
                    <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded p-2"
           
                        value={peakParams.minPeakHeight}
  onChange={(e) =>
    setPeakParams(prev => ({ ...prev, minPeakHeight: parseFloat(e.target.value) }))
  }
                    />
                </div>
            </div>
          </div>
        </details> */}

        {/* Peak Selection Section */}
        <div className="p-4 border rounded-lg shadow-md w-full">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Peak Selection</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-sm font-medium text-gray-700">hRF Range</label>
                      <InfoTip
                        tip={
                          'This value is the hRF matching threshold (tolerance) used when selecting/validating the same peak across tracks. Increase it to match peaks that shift more; decrease it for stricter matching.'
                        }
                        direction="bottom"
                      />
                    </div>
                    <input
                        type="number"
                        className="w-full border rounded p-2"
                        value={hRFRangeTolerance}
                        onChange={(e) => setHRFRangeTolerance(parseInt(e.target.value))}
                        min={1}
                    />
                </div>
            </div>
        </div>

          </div>

         <h2 className="text-xl font-semibold text-center mb-6">Integration & Stats</h2>

        {/* Number of Tracks Input */}
       <div className="mt-4 flex flex-col items-center justify-center gap-2">
  {/* Step Number */}
  <p className="text-sm text-gray-600">
    Track {bandStep} of {totalTracks}
  </p>

  {/* Navigation and Image */}
  <div className="flex items-center justify-center gap-4">
    {/* Left Arrow */}
    <button
      className="p-2 bg-white rounded-full shadow hover:bg-gray-100"
      onClick={() => {
        if (bandStep > 1) setBandStep(bandStep - 1);
      }}
      disabled={bandStep <= 1}
    >
      <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
    </button>

    {/* Image */}
    {data && (
      <img
        src={imgSrc}
        alt="quanTLC Image"
        className="w-full max-w-lg rounded-lg shadow-lg"
      />
    )}

    {/* Right Arrow */}
    <button
      className="p-2 bg-white rounded-full shadow hover:bg-gray-100"
      onClick={() => {
        if (bandStep < totalTracks) setBandStep(bandStep + 1);
      }}
      disabled={bandStep >= totalTracks}
    >
      <ArrowRightIcon className="h-6 w-6 text-gray-600" />
    </button>
  </div>
</div>

        {/* Buttons for Automatic Integration & Peak List */}
        <div className="flex justify-center space-x-4 mb-6 mt-6">
            {/* Select Standard Button */}
            
            <button
                className="btn btn-primary flex items-center ml-4"
                onClick={openSelectStandardModal}
            >
                <span className="mr-2">✅</span> Select Standard
            </button>

            {/* Select Standard Modal */}
            <dialog id="select_standard_modal" className="modal">
                <div className="modal-box w-11/12 max-w-7xl">
                    <h3 className="font-bold text-lg mb-4">Select Standard</h3>

                    {/* Standards Table */}
                    <div className="overflow-x-auto">
  <table className="table table-zebra w-full" key={`${selectedPeak?.channel}-${selectedPeak?.peak?.x}`}>
  <thead>
    <tr>
      <th>Track</th>
      <th>Select Standard</th>
      <th>To calibrate?</th>
      <th>Quantity</th>
      {selectedPeak?.channel && (
        <>
          <th>{`Peak Height (${selectedPeak.channel})`}</th>
          <th>{`Region Area (${selectedPeak.channel})`}</th>
          <th className="font-bold">{`Value (${quantityMetric})`}</th>
        </>
      )}
    </tr>
  </thead>

  <tbody>
    {Array.from({ length: totalTracks }).map((_, rowIndex) => {
      const isSelected = selectedStandards[`band-${rowIndex}`] || false;
      const isToCalibrate = tracksToCalibrate[`band-${rowIndex}`] ?? true;

      return (
        <tr key={`band-${rowIndex}`}>
          <td>{`Track ${rowIndex + 1}`}</td>

          <td>
            <input
              type="checkbox"
              className="checkbox"
              checked={isSelected}
              onChange={() => toggleStandard(`band-${rowIndex}`)}
            />
          </td>

          <td>
            <input
              type="checkbox"
              className="checkbox"
              checked={isToCalibrate}
              onChange={() => toggleTrackToCalibrate(`band-${rowIndex}`)}
            />
          </td>

          <td>
            <input
              type="number"
              step="0.01"
              className="input input-bordered input-sm w-24"
              value={autoPeakValues[rowIndex] ?? ""}
              defaultValue={0}
              onChange={(e) => handleQuantityChange(rowIndex, e.target.value)}
            />
          </td>

          {/* Peak Height Column */}
          {selectedPeak?.channel && (
            <>
              <td>
                {(() => {
                  const ch = selectedPeak.channel;
                  const bandKey = String(rowIndex + 1);
                  
                  // Prefer API peaks
                  if (apiPeaksResponse && apiChartPeaks[bandKey]) {
                    const apiPeaksForChannel = apiChartPeaks[bandKey][ch as keyof typeof apiChartPeaks[typeof bandKey]];
                    const closestApiPeak = getClosestApiPeak(apiPeaksForChannel, selectedPeak.peak?.x);
                    if (closestApiPeak) return closestApiPeak.y.toFixed(4);
                  }
                  
                  // Fallback to client-side
                  const peaks = (allPeaksOverAllData as any)?.[bandKey]?.[ch] as { x: number; y: number }[] | undefined;
                  const peakHeight = getClosestPeakY(peaks, selectedPeak.peak?.x);
                  return Number.isFinite(peakHeight) ? peakHeight.toFixed(4) : "-";
                })()}
              </td>
              
              {/* Region Area Column */}
              <td>
                {(() => {
                  const ch = selectedPeak.channel;
                  const bandKey = String(rowIndex + 1);
                  
                  // First check manual region area
                  const regionArea = regionAreasByTrack[rowIndex]?.[ch];
                  if (regionArea !== undefined && regionArea > 0) {
                    return regionArea.toFixed(4);
                  }
                  
                  // Then try API peak area
                  if (apiPeaksResponse && apiChartPeaks[bandKey]) {
                    const apiPeaksForChannel = apiChartPeaks[bandKey][ch as keyof typeof apiChartPeaks[typeof bandKey]];
                    const closestApiPeak = getClosestApiPeak(apiPeaksForChannel, selectedPeak.peak?.x);
                    if (closestApiPeak) return closestApiPeak.area.toFixed(4);
                  }
                  
                  return "-";
                })()}
              </td>
              
              {/* Quantity Value Column (what will be used for calibration) */}
              <td className="font-semibold bg-base-200">
                {Number.isFinite(quantityValues[rowIndex])
                  ? quantityValues[rowIndex].toFixed(4)
                  : "-"}
              </td>
            </>
          )}



        </tr>
      );
    })}
  </tbody>
</table>




</div>

                    <div className="modal-action">
                        <form method="dialog">
                            <button className="btn">Close</button>
                        </form>
                    </div>
                </div>
            </dialog>
            {/* <button className="btn btn-primary flex items-center">
                <span className="mr-2">⚙️</span> Perform Automatic Integration
            </button> */}
            <button
    className="btn  btn-primary flex items-center"
    onClick={() => (document.getElementById("my_modal_4")as HTMLDialogElement | null)
      ?.showModal()}
>
    <span className="mr-2">📋</span> Show Peak List
            </button>

<dialog id="my_modal_4" className="modal">
    <div className="modal-box w-11/12 max-w-7xl">
        <h3 className="font-bold text-lg mb-4">Peak List</h3>

        {/* Filter Input */}
        <div className="mb-4">
            <input
                type="text"
                placeholder="Filter peaks..."
                className="input input-bordered w-full"
                onChange={(e) => setFilter(e.target.value)}
            />
        </div>

        {/* Peak List Table */}
        <div className="overflow-x-auto mt-6">
  <table className="table table-zebra w-full">
    <thead>
      <tr>
        <th>Track</th>
        <th>Channels</th>
        <th>Start hRF</th>
        <th>End hRF</th>
        <th>hRF</th>
        <th>Height</th>
        <th>Area</th>
        <th>Quantity ({quantityMetric})</th>
      </tr>
    </thead>
    <tbody>
      {filteredPeaks.map((row, index) => (

        
        <tr key={index}>
          <td>{row.track}</td>
          <td className="capitalize">{row.channels}</td>
          <td>{row.startHRF}</td>
          <td>{row.endHRF}</td>
          <td>{row.hRF}</td>
          <td>{row.height}</td>
          <td>{row.area}</td>
          <td>{row.quantity}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>


        {/* Close Button */}
        <div className="modal-action">
            <form method="dialog">
                <button className="btn">Close</button>
            </form>
        </div>
    </div>
</dialog>

        </div>


        {/* Densitogram Graphs */}
         <div>
      {/* Toggle Button for Select Peak */}
      {/* <div className="flex items-center mb-4">
            <label className="mr-2 text-lg font-medium">Select Peak</label>
            <input
                type="checkbox"
                className="toggle"
                checked={selectPeakEnabled}
                onChange={() => setSelectPeakEnabled(!selectPeakEnabled)}
            />
        </div> */}

      {/* Channel Multi-Select */}
      <div className="mb-4 flex flex-wrap gap-4 items-center">
        <span className="font-medium mr-2">Select Channels:</span>
        {channelOptions.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={selectedChannels.includes(opt.value)}
              onChange={() => handleChannelToggle(opt.value)}
            />
            <span className="capitalize">{opt.label}</span>
          </label>
        ))}
      </div>

      {/* Densitogram Graphs - Only show selected channels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
        {/* Loading overlay for peak detection */}
        {apiPeaksLoading && (
          <div className="absolute inset-0 bg-white/70 z-10 flex flex-col items-center justify-center rounded-lg">
            <span className="loading loading-spinner loading-lg"></span>
            <p className="mt-2 text-gray-600 font-medium">Processing peaks...</p>
          </div>
        )}
        {selectedChannels.includes("red") && (
          <div className="w-full">
            <D3InteractiveChart
              data={redData}
              lineColor="red"
              fillColor="rgba(255, 0, 0, 0.3)"
              selectedPeakRef={peakRef}
              channelName="red"
              bandstep={bandStep}
              ref={chartRef}
              peakParams={peakParams}
              allPeaks={allPeaksRef.current}
              onRegionsChange={handleRegionsChange}
              onPeakAreaChange={handlePeakAreaChange}
              onEditPeakIntegration={handleEditPeakIntegration}
              onBatchAddPeaks={handleBatchAddPeaks}
              onNewRegionAdded={handleNewRegionAdded}
              addPeakModeExternal={globalAddPeakMode}
              onAddPeakModeToggle={handleAddPeakModeToggle}
              onPeakSelect={handlePeakSelect}
              apiPeaks={currentTrackApiPeaks.red}
              useApiPeaks={!!apiPeaksResponse}
            />
          </div>
        )}
        {selectedChannels.includes("blue") && (
          <div className="w-full">
            <D3InteractiveChart
              data={blueData}
              lineColor="blue"
              fillColor="rgba(0, 0, 255, 0.4)"
              selectedPeakRef={peakRef}
              channelName="blue"
              bandstep={bandStep}
              ref={chartRef}
              peakParams={peakParams}
              allPeaks={allPeaksRef.current}
              onRegionsChange={handleRegionsChange}
              onPeakAreaChange={handlePeakAreaChange}
              onEditPeakIntegration={handleEditPeakIntegration}
              onBatchAddPeaks={handleBatchAddPeaks}
              onNewRegionAdded={handleNewRegionAdded}
              addPeakModeExternal={globalAddPeakMode}
              onAddPeakModeToggle={handleAddPeakModeToggle}
              onPeakSelect={handlePeakSelect}
              apiPeaks={currentTrackApiPeaks.blue}
              useApiPeaks={!!apiPeaksResponse}
            />
          </div>
        )}
        {selectedChannels.includes("green") && (
          <div className="w-full">
            <D3InteractiveChart
              data={greenData}
              lineColor="green"
              fillColor="rgba(0, 255, 0, 0.3)"
              selectedPeakRef={peakRef}
              channelName="green"
              bandstep={bandStep}
              ref={chartRef}
              peakParams={peakParams}
              allPeaks={allPeaksRef.current}
              onRegionsChange={handleRegionsChange}
              onPeakAreaChange={handlePeakAreaChange}
              onPeakSelect={handlePeakSelect}
              onEditPeakIntegration={handleEditPeakIntegration}
              onBatchAddPeaks={handleBatchAddPeaks}
              onNewRegionAdded={handleNewRegionAdded}
              addPeakModeExternal={globalAddPeakMode}
              onAddPeakModeToggle={handleAddPeakModeToggle}
              apiPeaks={currentTrackApiPeaks.green}
              useApiPeaks={!!apiPeaksResponse}
            />
          </div>
        )}
        {selectedChannels.includes("grayscale") && (
          <div className="w-full">
            <D3InteractiveChart
              data={grayData}
              lineColor="gray"
              fillColor="rgba(128, 0, 128, 0.3)"
              selectedPeakRef={peakRef}
              channelName="grayscale"
              bandstep={bandStep}
              ref={chartRef}
              peakParams={peakParams}
              allPeaks={allPeaksRef.current}
              onRegionsChange={handleRegionsChange}
              onPeakAreaChange={handlePeakAreaChange}
              onPeakSelect={handlePeakSelect}
              onEditPeakIntegration={handleEditPeakIntegration}
              onBatchAddPeaks={handleBatchAddPeaks}
              onNewRegionAdded={handleNewRegionAdded}
              addPeakModeExternal={globalAddPeakMode}
              onAddPeakModeToggle={handleAddPeakModeToggle}
              apiPeaks={currentTrackApiPeaks.grayscale}
              useApiPeaks={!!apiPeaksResponse}
            />
          </div>
        )}
      </div>
      {/* Finish Edit Button
      <div className="flex justify-end mt-4">
        <button
          className="btn btn-primary"
          onClick={handleFinishEdit}
          disabled={!selectPeakEnabled}
        >
          Finish Edit
        </button>
      </div> */}
    </div>
    <div className="w-full mb-4">
  {/* Controls */}
  <div className="flex items-center gap-3 mb-3">
    <label className="label">
      <span className="label-text flex items-center gap-2">
        Calibration model
        <InfoTip
          tip={formatHelpTip((ADVANCED_PREPROCESS_HELP as any)["Calibration.Models"] as HelpEntry)}
          direction="bottom"
        />
      </span>
    </label>
    <select
      className="select select-bordered"
      value={modelType}
      onChange={(e) => setModelType(e.target.value as CalibrationModel)}
    >
      {modelOptions.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>

    {/* Quantity metric selector */}
    <label className="label ml-4">
      <span className="label-text">Quantity metric</span>
    </label>
    <select
      className="select select-bordered"
      value={quantityMetric}
      onChange={(e) => setQuantityMetric(e.target.value as 'height' | 'area')}
    >
      <option value="height">Peak Height</option>
      <option value="area">Peak Area</option>
    </select>
    <button className="btn btn-primary" onClick={handleGetSelectedPeak}>
      Calibrate
    </button>
  </div>
  
  {/* Helpful note about metric selection */}
  <div className="alert alert-info shadow-sm mb-3">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
    <span>
      {quantityMetric === 'height' 
        ? 'Using peak heights for calibration. Peak heights are automatically detected.'
        : 'Using region areas for calibration. Draw regions around peaks (brush mode) to define integration bounds. Region areas will be used if available, otherwise automatic area calculation around peak will be used.'}
    </span>
  </div>

  {showCurve && <CalibrationCurve />}
</div>
    
  {/* Calibration Loading Spinner */}
  {calibrationLoading && (
    <div className="mt-8 flex flex-col items-center">
      <span className="loading loading-spinner loading-lg"></span>
      <p className="mt-2 text-gray-600">Calculating calibration...</p>
    </div>
  )}

  {calibrationResult && !calibrationLoading && (
    <div className="mt-8 flex flex-col items-center">
      <h3 className="text-lg font-semibold mb-2">Calibration Curve</h3>

      {/* 1) Image */}
      {calibrateImg && (
        <img
          src={calibrateImg}
          alt="Calibration Curve"
          className="max-w-lg rounded shadow mb-4"
        />
      )}

      {/* 2) Scores */}
      {(typeof (calibrationResult as any).r2 === "number" ||
        typeof (calibrationResult as any).rmse === "number" ||
        (calibrationResult as any).model_type) && (
        <div className="w-full max-w-xl grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          <div className="p-3 rounded bg-base-200 text-center">
            <div className="text-xs uppercase text-gray-500">R²</div>
            <div className="text-lg font-semibold">
              {typeof (calibrationResult as any).r2 === "number"
                ? (calibrationResult as any).r2.toFixed(1)
                : "-"}
            </div>
          </div>
          <div className="p-3 rounded bg-base-200 text-center">
            <div className="text-xs uppercase text-gray-500">RMSE</div>
            <div className="text-lg font-semibold">
              {typeof (calibrationResult as any).rmse === "number"
                ? (calibrationResult as any).rmse.toExponential(2)
                : "-"}
            </div>
          </div>
          <div className="p-3 rounded bg-base-200 text-center">
            <div className="text-xs uppercase text-gray-500">Model</div>
            <div className="text-lg font-semibold">
              {(calibrationResult as any).model_type ?? "-"}
            </div>
          </div>
        </div>
      )}

      {/* 3) Equation */}
      {(calibrationResult as any).predictions?.equation && (
        <div className="bg-gray-100 p-4 rounded text-center mb-4">
          <span className="font-mono text-base">
            {(calibrationResult as any).predictions.equation}
          </span>
        </div>
      )}

      {/* Predicted amounts mapped to unknown peaks */}
      {(calibrationResult as any).predictions?.concentrations && (
        <div className="w-full max-w-xl mt-4">
          {<h4 className="font-semibold mb-2">Predicted Amounts for Unknown peak {quantityMetric}</h4>}
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Unknown Track</th>
                {/* <th>Peak Height</th> */}
                <th>Predicted Amount</th>
              </tr>
            </thead>
            <tbody>
              {(calibrationResult as any).predictions.concentrations.map((conc: number, idx: number) => (
                <tr key={idx}>
                  <td>{`TRACK ${unknownIndices[idx] + 1}`}</td>
                  {/* <td>
                    {Array.isArray(unknown_peaks) && unknown_peaks[idx] !== undefined
                      ? unknown_peaks[idx].toFixed(4)
                      : "-"}
                  </td> */}
                  <td>{Number(conc).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )}

    </div>
)}
    

{step === 3 && (
<div >results
</div>
)}

            {/* Buttons at the Bottom */}
            <div className="flex justify-center mt-8 w-full max-w-lg">
    <div className="flex gap-6">
        {step > 1 && (
            <button className="btn btn-secondary w-36" onClick={() => setStep(step - 1)}>
                ← Back
            </button>
        )}

    {step < 3 ? (
      <button className="btn btn-primary w-36" onClick={() => setStep(step + 1)}>
        Next →
      </button>
    ) : (
      <button className="btn btn-success w-36" onClick={handleDownloadReport}>
        Download Report
      </button>
    )}

    </div>
</div>

        </>
      )}

        </div>
    );
};

export default QuantTLC;
