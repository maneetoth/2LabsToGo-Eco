import numpy as np
import matplotlib.pyplot as plt
import io
import os
import base64
import json
from django.conf import settings
from scipy.signal import savgol_filter
from dtw import dtw
from copy import deepcopy
from typing import Optional
import numpy as np
from dtw import dtw
from copy import deepcopy
from typing import Optional
import numpy as np # Added
import numpy as np
###############################################################################################################################
# warping dtw and ptw
from dtaidistance import dtw
from numpy.polynomial import Polynomial
import numpy as np
from joblib import Parallel, delayed
import numpy as np
import json
import base64
import io
from PIL import Image
from pybaselines import morphological

def warping_dtw(query, template):
    """
    Perform Dynamic Time Warping (DTW) alignment between each band in query and the template.
    Returns a list of alignment results for all bands.
    """
    template = list(template)
    def align_band(band):
        band = list(band)
        alignment,_ = dtw.warp(band, template)
        return alignment
    # Parallelize over all bands in query
    results = Parallel(n_jobs=-1)(delayed(align_band)(band) for band in query)
    return results

def warping_ptw(query_batch, template, degree=1, segment_length=None):
    """
    Perform polynomial time warping (PTW) alignment for each band in query_batch to the template.
    Returns a list of aligned results for all bands.
    """
    if isinstance(degree, str()):
        degree= int(degree)
    template = list(template)
    def align_band(band):
        band = list(band)
        _, aligned_band = _single_ptw(band, template, degree, segment_length)
        print('done')
        return aligned_band

    results = Parallel(n_jobs=-1)(delayed(align_band)(band) for band in query_batch)
    return results

def _single_ptw(query, template, degree=1, segment_length=None):
    """
    Single-band PTW alignment (as before).
    """
    if isinstance(degree, str()):
        degree= int(degree)
    template = list(template)
    if segment_length is None:
        segment_length = len(template)
    aligned_segments = []
    segment_distances = []
    for i in range(0, len(query), segment_length):
        end_idx = min(i + segment_length, len(query))
        query_segment = np.array(query[i:end_idx]).ravel()
        seg_degree = min(degree, len(query_segment) - 1)
        if seg_degree >= 1:
            x_query = np.linspace(0, 1, len(query_segment))
            p_query = Polynomial.fit(x_query, query_segment, seg_degree)
            x_template = np.linspace(0, 1, len(query_segment))  
            aligned_segment = p_query(x_template)
            distance = np.sqrt(np.sum((aligned_segment - template) ** 2))
            aligned_segments.append(aligned_segment)
            segment_distances.append(distance)
        elif len(query_segment) == 1:
            aligned_segments.append(query_segment)
            distance = np.sqrt(np.sum((query_segment - template[:len(query_segment)]) ** 2))
            segment_distances.append(distance)
    if aligned_segments:
        aligned_query = np.concatenate(aligned_segments)
        total_distance = np.mean(segment_distances)
        aligned_query_list = [float(x) for x in aligned_query]
    else:
        aligned_query_list = []
        total_distance = float('inf')
    if len(aligned_query_list) < len(query):
        aligned_query_list.extend(query[len(aligned_query_list):])
    return total_distance, aligned_query_list
################################################################################################################################
# baseline line correction methods
import numpy as np
from scipy.signal import find_peaks
from numpy.lib.stride_tricks import sliding_window_view
from scipy.signal import medfilt, find_peaks, peak_widths
from pybaselines import whittaker, morphological, polynomial
from numpy.lib.stride_tricks import sliding_window_view
from scipy import sparse
from scipy.sparse.linalg import spsolve
from scipy.fft import rfft, irfft
# --- helpers (unchanged) ---
def _whittaker_smooth(y, lam, diff_order=2):
    y = np.asarray(y, float)
    n = y.size
    E = sparse.eye(n, format="csc")
    D = sparse.diags([1, -1], [0, 1], shape=(n-1, n), format="csc")
    for _ in range(int(diff_order) - 1):
        D = sparse.diags([1, -1], [0, 1], shape=(D.shape[0]-1, D.shape[0]), format="csc") @ D
    A = E + float(lam) * (D.T @ D)
    return spsolve(A, y)

def _gaussian_smooth(y, half_width):
    if not half_width or half_width <= 0:
        return y
    hw = int(half_width)
    x = np.arange(-hw, hw + 1)
    sigma = max(hw / 2.0, 1e-6)
    g = np.exp(-(x ** 2) / (2 * sigma * sigma))
    g /= g.sum()
    return np.convolve(y, g, mode="same")

def _rolling_stat(y, full_win, func=np.median, pad_mode="reflect"):
    w = int(full_win)
    if w < 1:
        return y
    if w % 2 == 0:
        w += 1
    pad = w // 2
    yp = np.pad(y, (pad, pad), mode=pad_mode)
    sw = sliding_window_view(yp, w)
    return func(sw, axis=-1)

def _lowpass_fft_baseline(y, steep=2.0, half=5.0):
    y = np.asarray(y, float)
    n = y.size
    Y = rfft(y)
    freqs = np.linspace(0, 1.0, Y.size)
    f_half = max(half, 1e-9) / 100.0
    mask = 1.0 / (1.0 + np.exp(float(steep) * (freqs - f_half)))
    return irfft(Y * mask, n=n)

def _medianwindow_baseline(signal, hwm, hws=None, end=False):
    """
    R-like 'baseline.medianWindow':
      - hwm: half-width for running median  -> window = 2*hwm + 1
      - hws: half-width for Gaussian smoothing (optional)
      - end: original endpoint handling (no reflection; shrink/asymmetric windows)
    """
    x = np.asarray(signal, float).ravel()
    hwm = int(hwm)
    w = max(3, 2 * hwm + 1)   # effective window size (odd, >=3)

    if end:
        # Original endpoint handling: compute medians on truncated/asymmetric windows at the edges
        n = x.size
        med = np.empty(n, dtype=float)
        for i in range(n):
            i0 = max(0, i - hwm)
            i1 = min(n, i + hwm + 1)
            med[i] = np.median(x[i0:i1])
    else:
        # Fast path with reflection padding (not "original", but commonly used in R helpers)
        pad = w // 2
        xp = np.pad(x, (pad, pad), mode="reflect")
        med = np.median(sliding_window_view(xp, w), axis=-1)

    # Optional Gaussian smoothing with half-width hws (R: "gaussian weighting")
    if hws is None or float(hws) <= 0:
        baseline = med
    else:
        baseline = _gaussian_smooth(med, float(hws))

    return baseline




def peak_detection(
    signal,
    left=10, right=300,          # width limits in points (valley-to-valley half-widths)
    lwin=50, rwin=50,            # flank windows for local background & rolling median
    hws=0,                       # optional Gaussian smoothing half-width on the baseline
    mono=0,                      # enforce non-increasing baseline if > 0
    snminimum=None,              # keep peaks with S/N >= snminimum (None disables)
    height=None, distance=None, prominence=None  # optional find_peaks gates
):
    """
    R-like baseline.peakDetection in one call.
    Returns dict: {baseline, corrected, peaks, sn, y, y2, y3}
    - Uses valley-to-valley peak widths (not FWHM) for filtering.
    - Suppresses entire peak segments between bracketing valleys before
      building the baseline via a rolling median envelope.

    Parameters mirror the R function semantics as closely as possible:
      left/right : minimum/maximum half-widths to valleys (in points)
      lwin/rwin  : half-windows for neighborhood statistics & median envelope
      hws        : optional Gaussian smoothing half-width on the baseline
      mono       : if >0, force baseline to be non-increasing
      snminimum  : S/N threshold for final peak set
    """

    x = np.asarray(signal, float).ravel()
    n = x.size

    # ---------- helpers ----------
    def _valley_bounds(arr, p):
        """Find nearest valleys (local minima) to the left and right of peak index p."""
        # left
        i = p
        # go down the left slope
        while i > 0 and arr[i-1] <= arr[i]:
            i -= 1
        # continue until the slope turns up (valley)
        while i > 0 and arr[i-1] >= arr[i]:
            i -= 1
        left_v = i
        # right
        i = p
        while i < n-1 and arr[i+1] <= arr[i]:
            i += 1
        while i < n-1 and arr[i+1] >= arr[i]:
            i += 1
        right_v = i
        # sanity
        left_v = max(0, min(left_v, p))
        right_v = min(n-1, max(right_v, p))
        return left_v, right_v

    def _gaussian_smooth(y, half_width):
        if half_width is None or half_width <= 0:
            return y
        hw = int(half_width)
        xx = np.arange(-hw, hw+1, dtype=float)
        sigma = max(hw/2.0, 1e-6)
        g = np.exp(-(xx*xx)/(2*sigma*sigma))
        g /= g.sum()
        return np.convolve(y, g, mode="same")

    # ---------- 1) initial candidates (y) ----------
    y, _ = find_peaks(x, height=height, distance=distance, prominence=prominence)

    # nothing to do?
    if y.size == 0:
        baseline = _gaussian_smooth(x.copy(), hws) if hws else x.copy()
        if mono:
            for i in range(1, baseline.size):
                if baseline[i] > baseline[i-1]:
                    baseline[i] = baseline[i-1]
        return {
            "baseline": baseline,
            "corrected": x - baseline,
            "peaks": np.array([], dtype=int),
            "sn": np.array([], dtype=float),
            "y": y, "y2": y, "y3": y
        }

    # ---------- 2) valley-to-valley width filter (y2) ----------
    Lv, Rv = zip(*(_valley_bounds(x, p) for p in y))
    Lv = np.array(Lv)
    Rv = np.array(Rv)
    Lw = y - Lv                   # left half-width (points)
    Rw = Rv - y                   # right half-width (points)
    keep = (Lw >= left) & (Rw <= right)
    y2 = y[keep]; Lv = Lv[keep]; Rv = Rv[keep]

    # ---------- 3) segment suppression (valley-to-valley) ----------
    x_sup = x.copy()
    for p, lv, rv in zip(y2, Lv, Rv):
        # flanking neighborhoods outside the peak segment [lv..rv]
        left_nei  = x[max(0, lv - lwin): lv]
        right_nei = x[rv+1: min(n, rv + 1 + rwin)]
        if left_nei.size + right_nei.size > 0:
            repl = np.median(np.r_[left_nei, right_nei])
        else:
            # fallback if near edges
            repl = np.min(x[lv:rv+1])
        x_sup[lv:rv+1] = repl

    # ---------- 4) rolling-median envelope -> baseline ----------
    win = max(3, 2 * int(min(lwin, rwin)) + 1)  # odd
    pad = win // 2
    xp = np.pad(x_sup, (pad, pad), mode="reflect")
    midspec = np.median(sliding_window_view(xp, win), axis=-1)
    baseline = _gaussian_smooth(midspec, hws) if hws and hws > 0 else midspec

    # optional monotone decreasing baseline
    if mono:
        for i in range(1, baseline.size):
            if baseline[i] > baseline[i-1]:
                baseline[i] = baseline[i-1]

    corrected = x - baseline

    # ---------- 5) S/N gate (final peaks) ----------
    y3 = y2.copy()
    peaks = y2.copy()
    sn = np.array([], dtype=float)
    if snminimum is not None and peaks.size:
        resid = corrected
        noise = np.median(np.abs(resid - np.median(resid))) / 0.6745 + 1e-12  # robust σ
        sn_vals = (x[peaks] - baseline[peaks]) / noise
        keep = sn_vals >= float(snminimum)
        peaks = peaks[keep]
        sn = sn_vals[keep]

    return {
        "baseline": baseline,
        "corrected": corrected,
        "peaks": peaks,   # final (after S/N)
        "sn": sn,         # S/N for kept peaks
        "y": y,           # initial candidates
        "y2": y2,         # width-filtered
        "y3": y3          # before S/N gate
    }






def rolling_ball_baseline(signal, half_window=100, smooth_half_window=50):
    """
    Rolling-ball baseline with reflection padding to fix edge effects.
    """
    pad = half_window  # pad by one radius
    ypad = np.pad(signal, (pad, pad), mode='reflect')
    base_pad, _ = morphological.rolling_ball(
        ypad,
        half_window=half_window,
        smooth_half_window=smooth_half_window
    )
    baseline = base_pad[pad:-pad]  # remove padding
    return baseline
import numpy as np
from scipy.signal import find_peaks, peak_widths

def baseline_peak_detection(
    signal,
    left=10, right=300,
    lwin=50, rwin=50,
    snminimum=None,
    mono=0,
    height=None, distance=None, prominence=None
):
    """
    Python analogue of baseline.peakDetection (R):
      - Detect candidates (y)
      - Width-filter (y2)
      - Suppress peaks locally & build rolling-median baseline (midspec)
      - Optional monotone baseline
      - Compute S/N and keep final peaks (peaks) with 'sn' values
      - y3 = peaks prior to S/N selection

    Returns:
      dict with keys:
        baseline, corrected, peaks, sn, y, y2, y3, midspec
    """
    x = np.asarray(signal, float).ravel()
    n = x.size

    # 1) initial candidates (y)
    y, _ = find_peaks(x, height=height, distance=distance, prominence=prominence)

    # 2) width filter (y2)
    y2 = y
    if y2.size:
        widths = peak_widths(x, y2, rel_height=0.5)[0]
        keep = (widths >= left) & (widths <= right)
        y2 = y2[keep]

    # 3) suppress peaks locally to estimate midspec (rolling median)
    x_np = x.copy()
    for p in y2:
        i0 = max(0, p - lwin)
        i1 = min(n, p + rwin + 1)
        # neighborhood excluding [i0, i1)
        left_nei  = x[max(0, i0 - lwin): i0]
        right_nei = x[i1: min(n, i1 + rwin)]
        local = np.r_[left_nei, right_nei]
        repl = np.median(local) if local.size > 0 else x[p]
        x_np[p] = repl

    # rolling median window = 2*min(lwin, rwin)+1 (odd)
    win = max(3, 2 * int(min(lwin, rwin)) + 1)
    pad = win // 2
    xp = np.pad(x_np, (pad, pad), mode='reflect')
    # fast sliding rolling median
    from numpy.lib.stride_tricks import sliding_window_view
    midspec = np.median(sliding_window_view(xp, win), axis=-1)

    # 4) optional monotone decreasing baseline
    if mono:
        for i in range(1, midspec.size):
            if midspec[i] > midspec[i - 1]:
                midspec[i] = midspec[i - 1]

    # 5) S/N selection
    y3 = y2.copy()  # peaks prior to S/N selection (R returns this)
    peaks = y2.copy()
    sn = np.array([], dtype=float)
    if snminimum is not None and peaks.size:
        resid = x - midspec
        # MAD-based noise estimate (like R implementations)
        noise = np.median(np.abs(resid - np.median(resid))) / 0.6745 + 1e-12
        sn_vals = (x[peaks] - midspec[peaks]) / noise
        keep = sn_vals >= float(snminimum)
        sn = sn_vals[keep]
        peaks = peaks[keep]

    baseline = midspec
    corrected = x - baseline

    return {
        "baseline": baseline,
        "corrected": corrected,
        "peaks": peaks,
        "sn": sn,
        "y3": y3,
        "midspec": midspec,
        "y": y,      # first estimate
        "y2": y2     # second estimate (after width filter)
    }

# --- main function (updated IRLS + shape handling) ---
def baseline_correction(data, method, **kwargs):
    """
    Perform baseline correction on 2D data (samples x points) or (samples x points x 1).
    Returns: np.ndarray with shape (samples, points).
    """
    if not isinstance(method, dict) or 'type' not in method:
        raise ValueError("method must be a dict with key 'type'.")
    X = np.asarray(data)
    if X.ndim == 3:
        if X.shape[2] != 1:
            raise ValueError("baseline_correction expects a single channel in the last axis.")
        X = X[..., 0]
    elif X.ndim != 2:
        raise ValueError("baseline_correction expects data shaped (n, t) or (n, t, 1).")
    method_type = str(method['type']).lower()
    corrected_rows = np.empty_like(X, dtype=float)
    for j in range(X.shape[0]):
        signal = X[j, :].astype(float).ravel()
        if method_type == "asls":

            baseline, _ = whittaker.asls(
                signal,
                lam = 10 ** float(method.get('lam', 5)),
                p=float(method.get('p', 0.01)),
                max_iter=int(method.get('max_iter', 50)),
                **kwargs
            )
        elif method_type == "irls":
            # Robust IRLS for Whittaker baseline
            lam1 = float(method.get('lam', method.get('lambda1', 1e5)))
            lam2 = 10 ** float(method.get('lam', 9))
            wi   = float(method.get('wi', 0.05))          # small weight on peaks
            tol  = float(method.get('tol', 1e-6))
            diff_order = int(method.get('diff_order', 2))
            max_iter = int(method.get('max_iter', 200))
            peaks_negative = bool(method.get('peaks_negative', False))
            trim_ends = int(method.get('trim_ends', 0))   # optional: down-weight edges
            baseline = _whittaker_smooth(signal, lam=lam1, diff_order=diff_order)
            for _ in range(max_iter):
                r = signal - baseline
                if peaks_negative:  # flip if peaks point downwards
                    r = -r
                w = np.where(r > 0, wi, 1.0 - wi)
                if trim_ends > 0:
                    w[:trim_ends] = 0.5
                    w[-trim_ends:] = 0.5
                y_w = w * signal + (1.0 - w) * baseline
                new_base = _whittaker_smooth(y_w, lam=lam2, diff_order=diff_order)
                if np.max(np.abs(new_base - baseline)) < tol:
                    baseline = new_base
                    break
                baseline = new_base
        elif method_type == "modpolyfit":
            baseline, _ = polynomial.imodpoly(
                signal,
                poly_order=int(method.get('degree', 4)),
                tol=float(method.get('tol', 0.001)),
                max_iter=int(method.get('max_iter', 100))
            
            )
        elif method_type == "fillpeaks":
            lambda_ =10 ** float(method.get('lam', 6))
            hwi     = int(method.get('hwi', 100))
            iters   = int(method.get('it', 10))
            n_buck  = int(method.get('int', 200))
            diff_order = int(method.get('diff_order', 2))
            base = _whittaker_smooth(signal, lam=lambda_, diff_order=diff_order)
            n = signal.size
            edges = np.linspace(0, n, n_buck + 1, dtype=int)
            for _ in range(iters):
                local_mean = _rolling_stat(signal - base, 2*hwi + 1, func=np.mean)
                new_base = base.copy()
                for b in range(n_buck):
                    i0, i1 = edges[b], edges[b+1]
                    if i1 <= i0:
                        continue
                    candidate = base[i0:i1] + local_mean[i0:i1]
                    new_base[i0:i1] = np.minimum(base[i0:i1], candidate)
                base = _whittaker_smooth(new_base, lam=lambda_, diff_order=diff_order)
            baseline = base
        elif method_type == "medianwindow":
            # R argument names:
            #   hwm = half-width for local medians
            #   hws = half-width for gaussian smoothing (optional)
            #   end = original endpoint handling (boolean)
            #
            # Backwards-compat: if user passed 'k_size', infer hwm = (k_size-1)//2.
            if 'hwm' in method:
                hwm = int(method.get('hwm', 300))
            else:
                ks = int(method.get('k_size', 2 * 300 + 1))  # default to ~R's example hwm=300 if k_size absent
                if ks % 2 == 0:
                    ks += 1
                hwm = max(1, (ks - 1) // 2)

            hws = method.get('hws', 5)
            hws = None if hws is None else float(hws)
            end_flag = bool(method.get('end', False))

            baseline = _medianwindow_baseline(signal, hwm=hwm, hws=hws, end=end_flag)

        elif method_type == "rollingball":
            baseline = rolling_ball_baseline(
                signal,
                half_window=int(method.get('half_window', 200)),
                smooth_half_window=int(method.get('smooth_half_window', 200))
            )
        elif method_type == "lowpass":
            baseline = _lowpass_fft_baseline(
                signal,
                steep=float(method.get('steep', 2.0)),
                half=float(method.get('half', 5.0))
            )
        elif method_type == "peakdetection":

            res = peak_detection(
                signal,
                left=int(method.get('left', 30)),
                right=int(method.get('right', 300)),
                lwin=int(method.get('lwin', 50)),
                rwin=int(method.get('rwin', 50)),
                hws=float(method.get('hws', 5)),
                mono=int(method.get('mono', 0)),
                snminimum=method.get('snminimum', 10),
                height=method.get('height', None),
                distance=method.get('distance', None),
                prominence=method.get('prominence', None)
            )

            baseline  = res["baseline"]
            corrected = res["corrected"]
            peaks     = res["peaks"]
            sn        = res["sn"]
        else:
            raise ValueError(f"Unsupported method_type: {method_type}")
        corrected_rows[j, :] = signal - baseline
    return corrected_rows
###########################################################################################################################################################
# smoothing methods
def Smoothing(data, input_opts):
    smoothed = []
    num_channels = data.shape[2] if len(data.shape) == 3 else 1
    for i in range(num_channels):
        channel = data[:, :, i] if len(data.shape) == 3 else data
        smoothed_channel = np.array([
            savgol_filter(row, window_length=int(input_opts['window.size']), polyorder=int(input_opts['poly.order']), deriv=int(input_opts['diff.order']))
            for row in channel
        ])
        smoothed.append(smoothed_channel)
    return np.stack(smoothed, axis=2) if len(data.shape) == 3 else smoothed[0]
####################################################################################################################################
# simple inversion method
def simple_inversion(data):
    """
    Inverts the entire data around zero. This will make positive values negative
    and negative values positive.
    :param data: Input data (samples x time x bands).
    :param input_opts: (Optional) Dictionary for future options, currently not used.
    :return: Inverted data.
    """
    inverted = -data
    min_val = np.min(inverted)
    if min_val < 0:
        inverted = inverted - min_val  # shift so minimum is zero
    return inverted
###########################################################################################################################

import numpy as np
import json
import base64
import io
from PIL import Image
import numpy as np
import json
import base64
import io
from PIL import Image

def resample_to_100(arr):
    """
    Resample a 1D densitogram array to exactly 100 data points using linear interpolation.

    Parameters
    ----------
    arr : array-like
        The input densitogram (e.g., red, green, blue, or grayscale intensity values).
        Can be a list or NumPy array of any length.

    Returns
    -------
    list of float
        A list containing 100 evenly resampled points representing the original signal.
        If the input array is empty, returns a list of 100 zeros.

    Notes
    -----
    - The function uses `np.interp` to perform linear interpolation between existing data points.
    - It preserves the overall trend of the input signal.
    - To additionally normalize the output between 0 and 1, uncomment the normalization line below.
    """

    arr = np.array(arr, dtype=float)
    
    if len(arr) == 0:
        return [0.0] * 100

    # Resample to 100 evenly spaced points
    old_idx = np.linspace(0, len(arr) - 1, len(arr))
    new_idx = np.linspace(0, len(arr) - 1, 100)
    arr_resampled = np.interp(new_idx, old_idx, arr)

    # Optional normalization (uncomment to enable)
    # arr_resampled = (arr_resampled - arr_resampled.min()) / (arr_resampled.max() - arr_resampled.min() + 1e-8)

    return arr_resampled.tolist()


def plot_before_preprocessing(
    band_info_dict, return_json=False
):
    """
    Processes the specified band image (rotated horizontally and flipped)
    and returns the densitogram data and image for all bands in JSON format,
    with optional preprocessing, without using matplotlib.
    """
    if not band_info_dict:
        print("Error: The band information dictionary is empty.")
        return {}
    
    if isinstance(band_info_dict, str):
        band_info_dict = json.loads(band_info_dict)
    
    band_numbers = band_info_dict.keys()


    raw_data = {}

    for selected_band_number in band_numbers:
        band_data = band_info_dict[selected_band_number]
        band_array = np.array(band_data['region_array'])
        band_array = band_array / 255.0
        if band_array.size == 0:
            print(f"Warning: region_array for band {selected_band_number} is empty.")
            band_array = np.zeros((1, 1))  # or skip this band with `continue`
            band_min = 0
            band_max = 0
        else:
            band_min = band_array.min()
            band_max = band_array.max()
        if band_max - band_min != 0:
            band_array = (band_array - band_min) / (band_max - band_min)
        else:
            band_array = np.zeros_like(band_array)

        # AFTER (match default R behavior)
        band_array = np.array(band_data['region_array']).astype(np.float32)
        if band_array.max() > 1.5:          # 8-bit → 0..1
            band_array /= 255.0

        
        if band_array is None:
            raise KeyError(f"'region_array' not found in band {selected_band_number}")
        
        is_color = False
        if len(band_array.shape) == 3:
            is_color = True
            r_densitogram = np.mean(band_array[:, :, 0], axis=1)
            g_densitogram = np.mean(band_array[:, :, 1], axis=1)
            b_densitogram = np.mean(band_array[:, :, 2], axis=1)
            grayscale_densitogram = np.mean(band_array, axis=2).mean(axis=1)
        elif len(band_array.shape) == 2:
            grayscale_densitogram = np.mean(band_array, axis=1)
            r_densitogram = g_densitogram = b_densitogram = grayscale_densitogram
        else:
            print(f"Error: band_array has shape {band_array.shape}, expected 2 or 3 dimensions.")
            return {}
        ####################################################################################
        r_densitogram = resample_to_100(r_densitogram)
        g_densitogram = resample_to_100(g_densitogram)
        b_densitogram = resample_to_100(b_densitogram)
        grayscale_densitogram = resample_to_100(grayscale_densitogram)


        # Flip/rotate image
        if is_color:
            rotated_band_array = np.rot90(band_array, k=-1)
            flipped_rotated_band_array = np.flipud(rotated_band_array)
        else:
            rotated_band_array = band_array
            flipped_rotated_band_array = np.flipud(rotated_band_array)
        
        # Convert numpy array to PIL Image
        mode = "RGB" if is_color else "L"
        img_8u = np.clip(flipped_rotated_band_array * 255.0, 0, 255).astype(np.uint8)
        img_pil = Image.fromarray(img_8u, mode=mode)
        
        # Save to buffer
        img_buf = io.BytesIO()
        img_pil.save(img_buf, format='PNG')
        img_buf.seek(0)
        
        # Encode to base64
        

        band_image = base64.b64encode(img_buf.getvalue()).decode('utf-8')
        raw_data[selected_band_number] = {
            "red": r_densitogram,
            "green": g_densitogram,
            "blue": b_densitogram,
            "grayscale": grayscale_densitogram,
            "band_image": band_image
        }

    return raw_data
    

import numpy as np
from copy import deepcopy
import json
def densitogram_after_preprocessing(densitogram_data: dict, preprocess_order: list, preprocess_option: dict):
    """
    Applies preprocessing to existing densitogram data (no re-extraction from image).
    Parameters:
    - densitogram_data: Dict containing band data from `plot_before_preprocessing()`
    - preprocess_order: List of preprocessing steps (e.g., ['Baseline.correction', 'Smoothing'])
    - preprocess_option: Dict of options for each step
    Returns:
    - JSON-serializable dict with processed densitograms
    """
    # Input validation
    if not isinstance(densitogram_data, dict):
        raise ValueError("densitogram_data must be a dictionary.")
    if not isinstance(preprocess_order, list):
        raise ValueError("preprocess_order must be a list.")
    if not isinstance(preprocess_option, dict):
        raise ValueError("preprocess_option must be a dictionary.")
    processed_data = deepcopy(densitogram_data)
    # Convert densitogram data into shape (samples, time, channels)
    bands = sorted(processed_data.keys(), key=lambda x: int(x))  # ensure order like ['1', '2', ...]
    channels = ['red', 'green', 'blue', 'grayscale']
    for channel in channels:
        # Gather all bands for this channel
        channel_matrix = np.array([processed_data[band][channel] for band in bands])  # shape: (bands, time)
        # channel_matrix: all channels of 17 bands
        channel_matrix = channel_matrix[:, :, np.newaxis]  # shape: (bands, time, 1)
        # shame channel matrix but just added one new_axis
        # need to check from here
        processed = apply_preprocessing(channel_matrix, preprocess_order, preprocess_option)
        # Update each band's processed signal
        for i, band in enumerate(bands):
            processed_data[band][channel] = processed[i, :, 0].tolist()
    return json.dumps(processed_data)


def apply_preprocessing(
    band_array: np.ndarray,
    preprocess_order: list,
    preprocess_option: dict,
    reference: Optional[np.ndarray] = None
) -> np.ndarray:
    # Input validation
    if not isinstance(band_array, np.ndarray):
        raise ValueError("band_array must be a numpy ndarray.")
    if not isinstance(preprocess_order, list):
        raise ValueError("preprocess_order must be a list.")
    if not isinstance(preprocess_option, dict):
        raise ValueError("preprocess_option must be a dictionary.")
    if reference is not None and not isinstance(reference, np.ndarray):
        raise ValueError("reference must be a numpy ndarray or None.")
    data = deepcopy(band_array)
    if reference is None:
        reference = deepcopy(data)
    if 'NegativePeakInversion' in preprocess_order: 
        data = simple_inversion(data)
    if 'Negatif' in preprocess_order:
        data = 1 - data
    if 'Smoothing' in preprocess_order:
        if 'Smoothing' in preprocess_option:
            data = Smoothing(data, preprocess_option['Smoothing'])
        else:
            print(f"Warning: 'Smoothing' options not found in preprocess_option.")
    if 'gammaCorrection' in preprocess_order:
        if 'gammaCorrection' in preprocess_option:
            gamma = preprocess_option['gammaCorrection']
            data = np.power(data, gamma)
        else:
            print(f"Warning: 'gammaCorrection' option not found in preprocess_option.")
    if 'baseline' in preprocess_order:
        data = baseline_correction(data, method=preprocess_option['baseline'])
        if data.ndim == 2:
            data = data[:, :, np.newaxis]
        else:
            # Use ASLS as the default baseline correction method
            default_method = {'type': 'asls', 'lam': 5, 'p': 0.01, 'max_iter': 50}
            data = baseline_correction(data, method=default_method)
            data = np.stack(data, axis=0)
            if data.ndim == 2:
                data = data[:, :, np.newaxis]
    if 'Warping' in preprocess_order:
        if 'Warping' in preprocess_option:
            # need to edit this
            if 'ptw' in preprocess_option['Warping'] and preprocess_option['Warping']['ptw']:
                # Only perform PTW if specified
                data = warping_ptw(
                    band_array,
                    reference[preprocess_option['Warping']['ptw']],
                    preprocess_option['Warping']['degree'],
                    preprocess_option['Warping']['seg_len']
                )
                print('warping(ptw) done')
                data = np.stack(data, axis=0)
                if data.ndim == 2:
                    data = data[:, :, np.newaxis]

                else:
                    print(f"Warning: 'Warping' options not found in preprocess_option.")
            elif 'dtw' in preprocess_option['Warping'] and preprocess_option['Warping']['dtw']:
                print('*' * 100)
                # Only perform DTW if specified
                data = warping_dtw(band_array, reference[preprocess_option['Warping']['dtw']])
                data = np.stack(data, axis=0)
                # If needed, add a new axis to match (bands, time, 1) shape
                if data.ndim == 2:
                    data = data[:, :, np.newaxis]
            else:
                print(f"Warning: 'Warping' options not found in preprocess_option.")
        else:
            raise ValueError("You must specify which warping option ('dtw' or 'ptw') to use in preprocess_option['Warping'].")
    # Ensure all values are positive
    data = np.maximum(data, 0)
    return data

'''# --- IRLS (robust Whittaker) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'irls',
                  'lambda1': 1e5, 'lambda2': 5e5,
                  'wi': 0.05, 'max_iter': 100,
                   }}
)
# --- ASLS (Whittaker with asym. weights) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'asls',
                  'lam': 1e5, 'p': 0.01, 'max_iter': 50}}
)
# --- MODPOLY (iterative modified polynomial) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'modpolyfit',
                  'degree': 4, 'tol': 1e-3, 'max_iter': 100}}
)
# --- FILLPEAKS (peak filling + Whittaker smooth) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'fillpeaks',
                  'lambda': 6.0, 'hwi': 50, 'it': 10, 'int': 2000
                 }}
)
# --- MEDIAN WINDOW (running median, optional gaussian smooth) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'medianWindow',
                  'k_size': 300, 'hws': 5, 'end': False}}
)
# --- ROLLING BALL (morphological) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'rollingball',
                  'half_window': 200, 'smooth_half_window': 200}}
)
# --- LOWPASS (FFT logistic low-pass) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'lowpass',
                  'steep': 2.0, 'half': 5.0}}
)
# --- PEAK DETECTION (median envelope via peak suppression) ---
data = densitogram_after_preprocessing(
    data, ['NegativePeakInversion','baseline'],
    {'baseline': {'type':'peakDetection',
                  'left': 10, 'right': 300, 'lwin': 50, 'rwin': 50,
                  'height': None, 'distance': None, 'prominence': None,
                  'snminimum': 3}}
)
'''# low_pass, median_widow and peak_detection
# baseline correction (not done)
# data= densitogram_after_preprocessing(data, ['baseline'],   {'baseline':{'type':'asls','lam':5,'p':0.05,'max_iter':20}})
# data= densitogram_after_preprocessing(data, ['baseline'],   {"baseline":{"type":"irls","lam":5,"max_iter":100, "lambda2":9, "wi":0.05 }})   ## need to check why i can not have lambda 2 and weights parameter
# data= densitogram_after_preprocessing(data, ['baseline'],   {'baseline':{'type':'modpolyfit','degree':3,'max_iter':50, 'tol':0.001}})
# fillpeaks not done
# data = densitogram_after_preprocessing(data,['baseline'],{'baseline': {'type': 'peak_detection', 'height': 0.5, 'distance': 5}})

# data= densitogram_after_preprocessing(data, ['baseline'],   {'baseline':{'type':'medianWindow','k_size':300}})    # we dont have hws need to take a look into that
# data= densitogram_after_preprocessing(data, ['baseline'],   {'baseline':{'type':'rollingball','half_window':200,'smooth_half_window':200} }})
# data= densitogram_after_preprocessing(data, ['baseline'],   {'baseline':{"type":"lowpass","cutoff":0.1,"order":5}})

# Warping (not done)
# need to varify  this again and check it properly if alll the values are correct and are we getting the correct densitogram
# data= densitogram_after_preprocessing(data, ['Warping'],   {'Warping':{'dtw':14 }})    # need to confirm wich band number is which 
# data= densitogram_after_preprocessing(data, ['Warping'],   {'Warping':{'ptw':13,'degree':2,'seg_len':100 }})

# why do we need gamma correction?
# gammaCorrection: (done)
# data= densitogram_after_preprocessing(data, ['gammaCorrection'],  {'gammaCorrection':1})

# NegativePeakInversion (done)
# data= densitogram_after_preprocessing(data, ['NegativePeakInversion'],  {'Smoothing':{'window.size':15,'poly.order':2, 'diff.order': 0 }})

# smoothing (done)
# savgol_filter(row, window_length=input_opts['window.size'], polyorder=input_opts['poly.order'], deriv=input_opts['diff.order']
