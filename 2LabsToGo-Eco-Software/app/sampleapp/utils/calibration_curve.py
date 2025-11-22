import numpy as np
from scipy.optimize import curve_fit
# import matplotlib.pyplot as plt
# import matplotlib
# matplotlib.use('TkAgg')
# import seaborn as sns

# 1. Model definitions
def hill_function(x, vmax, kd, h):
    return (vmax * (x**h)) / (kd + (x**h))

def michaelis_menten_origin(s, vmax, km):
    return (vmax * s) / (km + s)

def michaelis_menten_intercept(s, vmax, km, y_intercept):
    return (vmax * s) / (km + s) + y_intercept

# Linear models
def linear(s, m, b):
    """Linear calibration: y = m*x + b"""
    return m * s + b

def linear_origin(s, m):
    """Linear through origin: y = m*x"""
    return m * s

# 2. Fit calibration curve based on known data
def fit_calibration_curve(concentrations, peak_areas, model_type='hill'):
    """
    Fit a calibration curve to known data.

    Parameters:
        concentrations (array-like): Known concentrations.
        peak_areas (array-like): Corresponding peak areas.
        model_type (str): 'hill', 'mm_origin', 'mm_intercept', 'linear', or 'linear_origin'.

    Returns:
        popt (ndarray): Optimal parameters.
        model_func (callable): The model function.
    """
    concentrations = np.asarray(concentrations, dtype=float)
    peak_areas    = np.asarray(peak_areas, dtype=float)

    if model_type == 'hill':
        initial_guess = [peak_areas.max(), np.median(concentrations), 1.0]
        model_func = hill_function
    elif model_type == 'mm_origin':
        initial_guess = [peak_areas.max(), np.median(concentrations)]
        model_func = michaelis_menten_origin
    elif model_type == 'mm_intercept':
        initial_guess = [peak_areas.max(), np.median(concentrations), 0.0]
        model_func = michaelis_menten_intercept
    elif model_type == 'linear':
        m0 = peak_areas.max() / concentrations.max()
        initial_guess = [m0, 0.0]
        model_func = linear
    elif model_type == 'linear_origin':
        m0 = peak_areas.max() / concentrations.max()
        initial_guess = [m0]
        model_func = linear_origin
    else:
        raise ValueError("Invalid model type. Choose 'hill', 'mm_origin', 'mm_intercept', 'linear', or 'linear_origin'.")

    consts, pcov = curve_fit(model_func, concentrations, peak_areas, p0=initial_guess)
   
    return consts, model_func

# 3. Predict concentrations for unknown peaks
def predict_concentration(peak_values, consts, model_type='hill'):
    """
    Given peak areas, invert the fitted model to estimate concentrations.

    Parameters:
        peak_values (array-like): Peak areas to invert.
        popt (ndarray): Fitted parameters from curve fitting.
        model_type (str): Same model used for fitting.

    Returns:
        predictions (ndarray): Estimated concentrations.
    """
    y = np.asarray(peak_values, dtype=float)
    if model_type == 'hill':
        vmax, kd, h = consts
        xh = (y * kd) / (vmax - y)
        return xh**(1.0 / h)
    elif model_type == 'mm_origin':
        vmax, km = consts
        return (km * y) / (vmax - y)
    elif model_type == 'mm_intercept':
        vmax, km, y0 = consts
        y_adj = y - y0
        return (km * y_adj) / (vmax - y_adj)
    elif model_type == 'linear':
        m, b = consts
        return (y - b) / m
    elif model_type == 'linear_origin':
        m, = consts
        return y / m
    else:
        raise ValueError(f"Invalid model_type: {model_type}")
# 4. Equation formatting
def get_superscript(num: int) -> str:
    sup = {"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵",
           "6":"⁶","7":"⁷","8":"⁸","9":"⁹"}
    return ''.join(sup[c] for c in str(num))
def get_equation_string(coeffs, model_type):
    terms = []
    for index, coef in enumerate(coeffs):
        rounded = round(coef, 3)
        if abs(rounded) < 1e-6:  # Skip near-zero terms
            continue
        if index == 0:
            terms.append(f"{rounded}")
        elif index == 1:
            terms.append(f"{rounded}x")
        else:
            terms.append(f"{rounded}x{get_superscript(index)}")
    return " + ".join(terms)
# 5. Calibration & prediction with extended plotting
def calibrate_and_predict(
    known_conc, known_peaks,
    unknown_peaks,
    model_type='hill',
):
    """
    Fit calibration curve on known data, predict unknown concentrations,
    and plot using seaborn. Returns results with a base64-encoded curve plot,
    R2 score, and RMSE error for the fit.
    """
    import base64
    from io import BytesIO
    import numpy as np
    # import matplotlib.pyplot as plt
    # import seaborn as sns
    from sklearn.metrics import r2_score, mean_squared_error

    # --- Fit model & predict ---
    popt, model_func = fit_calibration_curve(known_conc, known_peaks, model_type)
    preds = predict_concentration(unknown_peaks, popt, model_type)

    popt_list = np.asarray(popt).tolist()
    preds_list = np.asarray(preds).tolist()
    equation_str = get_equation_string(popt_list, model_type)

    # --- Curve data ---
    all_x = np.array(list(known_conc) + list(preds_list))
    all_y = np.array(list(known_peaks) + list(unknown_peaks))
    x_min, x_max = float(np.min(all_x)), float(np.max(all_x))
    y_min, y_max = float(np.min(all_y)), float(np.max(all_y))

    x_margin = (x_max - x_min) * 0.15 if x_max > x_min else 2
    y_margin = (y_max - y_min) * 0.15 if y_max > y_min else 2

    # For origin and intercept models, ensure curve starts at zero
    if model_type in ['mm_origin', 'linear_origin', 'mm_intercept']:
        curve_x_min = 0.0
    else:
        curve_x_min = x_min

    # Extend curve range slightly beyond the largest data point for visibility
    x_range = np.linspace(curve_x_min, x_max + x_margin, 300)
    y_fit = model_func(x_range, *popt)

    # --- Calculate R2 and RMSE on known data ---
    y_pred_known = model_func(np.array(known_conc), *popt)
    r2 = r2_score(known_peaks, y_pred_known)
    rmse = mean_squared_error(known_peaks, y_pred_known)

    # --- Seaborn plot ---
    # plt.figure(figsize=(8, 5))
    # sns.scatterplot(x=known_conc, y=known_peaks, color='red', label='Known Data')
    # sns.lineplot(x=x_range, y=y_fit, color='blue', label='Fitted Curve')
    # sns.scatterplot(x=preds_list, y=unknown_peaks, color='green', marker='X', s=100, label='Predicted')
    # plt.xlabel('Concentration')
    # plt.ylabel('Peak Area')
    # plt.title('Calibration Curve')
    # plt.grid(True)
    # plt.legend()
    # plt.tight_layout()
    # plt.xlim(x_min, x_max + x_margin * 1.2)
    # plt.ylim(0, y_max + y_margin * 1.2)  # <-- y-axis always starts at 0
    buf = BytesIO()
    # plt.savefig(buf, format='png')
    # plt.close()
    buf.seek(0)
    plot_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    # --- Result ---
    # show_base64_image(plot_base64)
    return {
        'known_data': {
            'concentrations': list(map(float, known_conc)),
            'peak_areas': list(map(float, known_peaks))
        },
        'predictions': {
            'concentrations': preds_list,
            'peak_areas': list(map(float, unknown_peaks)),
            'equation': equation_str
        },
        'model_type': model_type,
        'params': popt_list,
        'r2': r2,
        'rmse': rmse,
        'plot_base64': plot_base64
    }


# def show_base64_image(plot_base64: str):
#     """
#     Decode a base64-encoded PNG string and display it using matplotlib.
#     Useful for testing calibration curve output.
#     """
#     import base64
#     from io import BytesIO
#     import matplotlib.pyplot as plt
#     import matplotlib.image as mpimg

#     img_data = base64.b64decode(plot_base64)
#     buf = BytesIO(img_data)
#     img = mpimg.imread(buf, format='png')
#     plt.figure(figsize=(6, 4))
#     plt.imshow(img)
#     plt.axis('off')
#     plt.title("Calibration Curve")
#     plt.show()  # <-- Add this line to display the window

# if __name__ == "__main__":
#     # Dummy input data for local testing
#     known_conc = [1, 2, 5, 10, 20, 50, 100]
#     known_peaks = [3, 10, 30, 60, 80, 90, 95]
#     unknown_peaks = [35, 85, 94]
#     model_type = "hill"

#     result = calibrate_and_predict(
#         known_conc=known_conc,
#         known_peaks=known_peaks,
#         unknown_peaks=unknown_peaks,
#         model_type=model_type
#     )

#     print("Calibration Result:")
#     for k, v in result.items():
#         if k != "plot_base64":
#             print(f"{k}: {v}")
#     print("\nCalibration curve image should pop up in a new window.")
