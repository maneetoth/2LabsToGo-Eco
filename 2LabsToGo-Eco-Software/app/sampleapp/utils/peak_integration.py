import numpy as np
from scipy.signal import find_peaks

def get_peaks_and_area(x, height=None, threshold=None, distance=30,
                       prominence=None, width=None, wlen=None, rel_height=0.5,
                       plateau_size=None, Min_peak_area=None, find_area=True):
    """
    Finds peaks in a 1D signal and calculates the area under each peak.
    Parameters:
    x : array_like
        The 1D signal array to be analyzed.
    height : number or ndarray, optional
        Required height of peaks. See scipy.signal.find_peaks.
    threshold : number or ndarray, optional
        Required threshold of peaks. See scipy.signal.find_peaks.
    distance : number, optional
        Required minimal horizontal distance (>= 1) between neighboring peaks. Default is 30.
    prominence : number or ndarray, optional
        Required prominence of peaks. See scipy.signal.find_peaks.
    width : number or ndarray, optional
        Required width of peaks. See scipy.signal.find_peaks.
    wlen : int, optional
        Used for calculating prominence. See scipy.signal.find_peaks.
    rel_height : float, optional
        Used for calculating width. See scipy.signal.find_peaks.
    plateau_size : number or ndarray, optional
        Required size of the plateau. See scipy.signal.find_peaks.
    Min_peak_area : float, optional
        Minimum area threshold. Peaks with area below this value are excluded from the result.
    find_area : bool, optional
        If True (default), calculates the area and start/end boundaries for each peak.
    Returns:
    result_dict : dict
        A dictionary where keys are peak indices (int) and values are dicts containing:
        - "peak_height" (float): The value of the signal at the peak.
        - "peak_x" (int): The index of the peak.
        - "start_end" (tuple of int): (start_index, end_index) based on slope changes.
        - "area" (float): The integrated area calculated via trapezoidal rule.
    """
    t = np.arange(len(x)) 
    peaks, _ = find_peaks(x, height=height, threshold=threshold, distance=distance,
                           prominence=prominence, width=width, wlen=wlen,
                           rel_height=rel_height, plateau_size=plateau_size)
    dx = np.diff(x)  
    result_dict = {}
    for p in peaks:
        start, end = p, p
        while start > 0 and dx[start-1] > 0:
            start -= 1
        while end < len(dx) and dx[end] < 0:
            end += 1
        area_val = float(np.trapz(x[start:end+1], t[start:end+1]))
        if Min_peak_area is not None and area_val < Min_peak_area:
            continue
        entry = {
            "peak_height": float(x[p]),
            "peak_x": int(t[p]),
        }
        if find_area:
            entry["start_end"] = (int(start), int(end))
            entry["area"] = area_val
        result_dict[int(p)] = entry  
    return result_dict



def update_peak_areas(x, existing_peaks_dict, find_area=True, Min_peak_area=None):

    """
    Update peak areas strictly based on the start_end values provided
    in an existing peak dictionary.
    Parameters
    ----------
    x : array-like
        The input signal array.
    existing_peaks_dict : dict
        Dictionary containing existing peak information. 
        Must contain 'peak_x', 'peak_height', and 'start_end' for each peak entry.
    find_area : bool, optional
        Whether to recalculate the area based on the signal x and provided boundaries.
    Min_peak_area : float, optional
        If provided, filter out peaks whose recalculated area is less than this value.
    Returns
    -------
    updated_peaks_dict : dict
        A new dictionary with recalculated areas and the same structure as the input,
        filtering out any peaks that fall below Min_peak_area.
    """

    t = np.arange(len(x))
    updated_dict = {}

    for p_idx, peak_info in existing_peaks_dict.items():

        entry = {
            "peak_height": float(peak_info["peak_height"]),
            "peak_x": int(peak_info["peak_x"])
        }

        if find_area:

            if "start_end" in peak_info:
                start, end = peak_info["start_end"]
                start, end = int(start), int(end)
            else:
                start = end = int(peak_info["peak_x"])

            area_val = float(np.trapz(x[start:end+1], t[start:end+1]))

            if Min_peak_area is not None and area_val < Min_peak_area:
                continue

            entry["start_end"] = (start, end)
            entry["area"] = area_val

        updated_dict[int(p_idx)] = entry

    return updated_dict
