import numpy as np
from scipy.signal import find_peaks

def get_peaks_and_area(x, height=None, threshold=None, distance=30,
                       prominence=None, width=None, wlen=None, rel_height=0.5,
                       plateau_size=None, Min_peak_area=None, find_area=True):
    t = np.arange(len(x))  # x-axis values

    # Find peaks
    peaks, _ = find_peaks(x, height=height, threshold=threshold, distance=distance,
                           prominence=prominence, width=width, wlen=wlen,
                           rel_height=rel_height, plateau_size=plateau_size)

    dx = np.diff(x)  # slope

    result_dict = {}

    for p in peaks:
        # Slope-based start/end of peak area
        start, end = p, p
        while start > 0 and dx[start-1] > 0:
            start -= 1
        while end < len(dx) and dx[end] < 0:
            end += 1

        # Compute area under peak
        area_val = float(np.trapz(x[start:end+1], t[start:end+1]))

        # Check min peak area
        if Min_peak_area is not None and area_val < Min_peak_area:
            continue

        # Build dictionary entry with native Python types
        entry = {
            "peak_height": float(x[p]),
            "peak_x": int(t[p]),
        }

        if find_area:
            entry["start_end"] = (int(start), int(end))
            entry["area"] = area_val

        result_dict[int(p)] = entry  # key as native int

    # Plotting
    # plt.figure(figsize=(10,5))
    # plt.plot(t, x, marker='o', label='Signal')
    # for p, info in result_dict.items():
    #     plt.axvline(x=p, color='r', linestyle='--')
    #     if find_area:
    #         start, end = info["start_end"]
    #         plt.fill_between(t[start:end+1], x[start:end+1], alpha=0.3, color='orange')
    #         plt.text(p, x[p]+0.002, f"{info['area']:.3f}", ha='center', color='b')

    # plt.title("Signal with Peaks" + (" and Area" if find_area else ""))
    # plt.xlabel("Index")
    # plt.ylabel("Value")
    # plt.legend()
    # plt.grid(True)
    # plt.show()

    return result_dict


import numpy as np

def update_peak_areas(x, existing_peaks_dict, find_area=True, Min_peak_area=None):
    """
    Update peak areas strictly based on the start_end values provided
    in existing_peaks_dict.

    Parameters
    ----------
    x : array-like
        Signal array
    existing_peaks_dict : dict
        Dictionary with peak info: peak_x, peak_height, start_end, area
    find_area : bool
        Whether to recalculate area
    Min_peak_area : float
        Filter out peaks with area < Min_peak_area
    Returns
    -------
    updated_peaks_dict : dict
        Updated peaks dictionary with recalculated areas
    """

    t = np.arange(len(x))
    updated_dict = {}

    for p_idx, peak_info in existing_peaks_dict.items():

        entry = {
            "peak_height": float(peak_info["peak_height"]),
            "peak_x": int(peak_info["peak_x"])
        }

        if find_area:

            # --- ✔ USE GIVEN start_end DIRECTLY ---
            if "start_end" in peak_info:
                start, end = peak_info["start_end"]
                start, end = int(start), int(end)
            else:
                # fallback if missing
                start = end = int(peak_info["peak_x"])

            # --- ✔ RECALCULATE AREA ONLY BASED ON PROVIDED start/end ---
            area_val = float(np.trapz(x[start:end+1], t[start:end+1]))

            # --- Filter by Min_peak_area ---
            if Min_peak_area is not None and area_val < Min_peak_area:
                continue

            entry["start_end"] = (start, end)
            entry["area"] = area_val

        updated_dict[int(p_idx)] = entry

    return updated_dict




# Example usage
# if __name__ == "__main__":
#     x = np.array([
#         0.0,0.0,0.007908114856627846,0.03371665529004644,0.07052384383585382,
#         0.10588771176039855,0.15665847660372828,0.20884580755230975,0.25297704882868044,
#         0.26691832138342064,0.25809014483017834,0.24209222966774974,0.20992280921064924,
#         0.18701357122301757,0.16427851225711965,0.1522041255431626,0.14559038943660385,
#         0.16216573798750245,0.1761496004424466,0.17931676753156284,0.17809436752076063,
#         0.152362712775148,0.11718899547501926,0.08335996627891354,0.04977260298200581,
#         0.03324900202954445,0.01413263791494751,0.00720299095368275,0.008095162122775112,
#         0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.008011915826714608,0.02351033829525312,
#         0.04454846518927026,0.07918583154650478,0.10541372756739346,0.10707202751169069,
#         0.11147431022971016,0.09516764330484342,0.08564901431776485,0.07541894596642396,
#         0.06105003334284122,0.055404558739866216,0.05669237275274874,0.053151252039801755,
#         0.034236354529409666,0.022359227117085434,0.02031831526022254,0.015106422176393394,
#         0.009746026659135543,0.014127681232085923,0.01227490335579777,0.007638091345053957,
#         0.008719964978284742,0.0036590021035623754,0.00288049035515775,0.00318860890297773,
#         0.0059813478807811266,0.0,0.0023539305917037456,6.162108512604292e-05,0.0,0.0,
#         0.006597648022970901,0.00329150255232398,0.004038645270501726,0.005477838718976322,
#         0.00844427212053915,0.008779711685305544,0.007031606530504331,0.005351701839751033,
#         0.005670359605596739,0.006665971471121732,0.0071315428256691765,0.011294233856158173,
#         0.007638907514038451,0.011444436563970109,0.016591701392813574,0.014623897912102918,
#         0.010659411221772636,0.01522799519342323,0.009717380499840708,0.015597133251543924,
#         0.01020603268858479,0.013044987670764813,0.017134198782005533,0.01718975832929509,
#         0.018885144266862178,0.017461047622383388,0.022433708377307265,0.01848855200931121,
#         0.017729067907528887,0.021318907110164112,0.01909268030586652
#     ])

#     peaks_info =  get_peaks_and_area(x, height=None, threshold=None, distance=30,
#                        prominence=None, width=None, wlen=None, rel_height=0.5,
#                        plateau_size=None, Min_peak_area=None, find_area=True)
#     print(peaks_info)