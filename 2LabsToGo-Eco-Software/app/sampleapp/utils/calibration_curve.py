import numpy as np
from scipy.optimize import curve_fit, OptimizeWarning
import matplotlib
matplotlib.use('Agg')  #
import matplotlib.pyplot as plt
import seaborn as sns
import warnings
import base64
from io import BytesIO
from sklearn.metrics import r2_score, mean_squared_error
from sklearn.preprocessing import PolynomialFeatures
from sklearn.linear_model import LinearRegression

def hill_function(x, vmax, kd, h):
    return (vmax * (x**h)) / (kd + (x**h))

def michaelis_menten_origin(s, vmax, km):
    return (vmax * s) / (km + s)

def michaelis_menten_intercept(s, vmax, km, y_intercept):
    return (vmax * s) / (km + s) + y_intercept

def poly2(s, a0, a1, a2):
    """Quadratic calibration: y = a0 + a1*x + a2*x^2"""
    s = np.asarray(s, dtype=float)
    return a0 + a1 * s + a2 * (s ** 2)

def linear(s, m, b):
    """Linear calibration: y = m*x + b"""
    return m * s + b

def linear_origin(s, m):
    """Linear through origin: y = m*x"""
    return m * s

def fit_calibration_curve(concentrations, peak_areas, model_type='hill'):
    """
    Fit a calibration curve to known data.

    Parameters:
        concentrations (array-like): Known concentrations.
        peak_areas (array-like): Corresponding peak areas.
        model_type (str): 'hill', 'mm_origin', 'mm_intercept', 'linear', 'linear_origin', or 'poly2'.

    Returns:
        popt (ndarray): Optimal parameters.
        model_func (callable): The model function.

kd tree 
true false 

    """

    concentrations = np.asarray(concentrations, dtype=float)
    peak_areas    = np.asarray(peak_areas, dtype=float)

    if model_type == 'hill':
        initial_guess = [peak_areas.max(), np.median(concentrations), 1.0]
        model_func = hill_function
        bounds = ([0.0, 0.0, 0.01], [np.inf, np.inf, 10.0])
    elif model_type == 'mm_origin':
        initial_guess = [peak_areas.max(), np.median(concentrations)]
        model_func = michaelis_menten_origin
        bounds = ([0.0, 0.0], [np.inf, np.inf])
    elif model_type == 'mm_intercept':
        initial_guess = [peak_areas.max(), np.median(concentrations), 0.0]
        model_func = michaelis_menten_intercept
        bounds = ([0.0, 0.0, -np.inf], [np.inf, np.inf, np.inf])
    elif model_type == 'linear':
        m0 = peak_areas.max() / concentrations.max()
        initial_guess = [m0, 0.0]
        model_func = linear
        bounds = ([-np.inf, -np.inf], [np.inf, np.inf])
    elif model_type == 'linear_origin':
        m0 = peak_areas.max() / concentrations.max()
        initial_guess = [m0]
        model_func = linear_origin
        bounds = ([0.0], [np.inf])
    elif model_type == 'poly2':

        X = concentrations.reshape(-1, 1)
        poly = PolynomialFeatures(degree=2, include_bias=True)
        X_poly = poly.fit_transform(X)  # columns: [1, x, x^2]
        reg = LinearRegression(fit_intercept=False)
        reg.fit(X_poly, peak_areas)

        consts = np.asarray(reg.coef_, dtype=float)
        if consts.shape[0] != 3:
            raise RuntimeError(f"poly2 fit expected 3 coefficients, got {consts.shape[0]}")

        return consts, poly2
    else:
        raise ValueError("Invalid model type. Choose 'hill', 'mm_origin', 'mm_intercept', 'linear', 'linear_origin', or 'poly2'.")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", OptimizeWarning)
        consts, pcov = curve_fit(
            model_func,
            concentrations,
            peak_areas,
            p0=initial_guess,
            bounds=bounds,
            maxfev=20000
        )
    return consts, model_func

def predict_concentration(peak_values, consts, model_type='hill'):
    """
    Given peak areas, invert the fitted model to estimate concentrations.
    Returns NaN for out-of-domain inputs (e.g., y >= vmax).
    """
    y = np.asarray(peak_values, dtype=float)
    preds = np.full_like(y, np.nan, dtype=float)
    eps = np.finfo(float).eps

    if model_type == 'hill':
        vmax, kd, h = consts
        h = max(float(h), 1e-6)
        valid = (y > 0) & (y < vmax)
        denom = np.maximum(vmax - y[valid], eps)
        xh = (y[valid] * kd) / denom
        preds[valid] = np.power(xh, 1.0 / h)
        preds[y <= 0] = 0.0

    elif model_type == 'mm_origin':
        vmax, km = consts
        valid = (y >= 0) & (y < vmax)
        denom = np.maximum(vmax - y[valid], eps)
        preds[valid] = (km * y[valid]) / denom
        preds[y == 0] = 0.0
    elif model_type == 'mm_intercept':
        vmax, km, y0 = consts
        y_adj = y - y0
        valid = (y_adj > 0) & (y_adj < vmax)
        denom = np.maximum(vmax - y_adj[valid], eps)
        preds[valid] = (km * y_adj[valid]) / denom
        preds[y_adj <= 0] = np.nan
    elif model_type == 'linear':
        m, b = consts
        denom = m if abs(m) > eps else np.nan
        preds = (y - b) / denom
    elif model_type == 'linear_origin':
        m, = consts
        denom = m if abs(m) > eps else np.nan
        preds = y / denom
    elif model_type == 'poly2':
        a0, a1, a2 = map(float, consts)
        if abs(a2) <= 1e-18:
            denom = a1 if abs(a1) > eps else np.nan
            preds = (y - a0) / denom
        else:
            A = a2
            B = a1
            C = a0 - y
            disc = B * B - 4.0 * A * C
            valid = disc >= 0
            sqrt_disc = np.zeros_like(disc, dtype=float)
            sqrt_disc[valid] = np.sqrt(disc[valid])

            x1 = np.full_like(y, np.nan, dtype=float)
            x2 = np.full_like(y, np.nan, dtype=float)
            denom2 = 2.0 * A
            x1[valid] = (-B + sqrt_disc[valid]) / denom2
            x2[valid] = (-B - sqrt_disc[valid]) / denom2

            dx1 = B + 2.0 * A * x1
            dx2 = B + 2.0 * A * x2
            x1_ok = np.isfinite(x1) & (x1 >= 0) & (dx1 > 0)
            x2_ok = np.isfinite(x2) & (x2 >= 0) & (dx2 > 0)

            preds = np.full_like(y, np.nan, dtype=float)
            both_ok = x1_ok & x2_ok
            preds[both_ok] = np.minimum(x1[both_ok], x2[both_ok])
            only_x1 = x1_ok & ~x2_ok
            preds[only_x1] = x1[only_x1]
            only_x2 = x2_ok & ~x1_ok
            preds[only_x2] = x2[only_x2]

            x1_nn = np.isfinite(x1) & (x1 >= 0)
            x2_nn = np.isfinite(x2) & (x2 >= 0)
            unresolved = ~np.isfinite(preds) & (x1_nn | x2_nn)
            if np.any(unresolved):
                pick_x1 = unresolved & x1_nn & ~x2_nn
                pick_x2 = unresolved & x2_nn & ~x1_nn
                pick_both = unresolved & x1_nn & x2_nn
                preds[pick_x1] = x1[pick_x1]
                preds[pick_x2] = x2[pick_x2]
                preds[pick_both] = np.minimum(x1[pick_both], x2[pick_both])
    else:
        raise ValueError(f"Invalid model_type: {model_type}")
    print("+"*100)
    return preds

def get_superscript(num: int) -> str:
    sup = {"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵",
           "6":"⁶","7":"⁷","8":"⁸","9":"⁹"}
    return ''.join(sup[c] for c in str(num))
def get_equation_string(coeffs, model_type):
    if model_type == 'poly2':
        a0, a1, a2 = (float(coeffs[0]), float(coeffs[1]), float(coeffs[2]))

        def fmt(v: float) -> str:
            if v == 0.0:
                return "0"
            return f"{v:.6g}"

        return f"{fmt(a0)} + {fmt(a1)}x + {fmt(a2)}x{get_superscript(2)}"

    terms = []
    for index, coef in enumerate(coeffs):
        if abs(float(coef)) < 1e-12:
            continue
        rounded = round(float(coef), 3)
        if index == 0:
            terms.append(f"{rounded}")
        elif index == 1:
            terms.append(f"{rounded}x")
        else:
            terms.append(f"{rounded}x{get_superscript(index)}")
    return " + ".join(terms)
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
    popt, model_func = fit_calibration_curve(known_conc, known_peaks, model_type)
    preds = predict_concentration(unknown_peaks, popt, model_type)

    popt_list = np.asarray(popt).tolist()
    preds_arr = np.asarray(preds, dtype=float)
    unknown_arr = np.asarray(unknown_peaks, dtype=float)
    valid_mask = np.isfinite(preds_arr)
    preds_list = preds_arr[valid_mask].tolist()
    unknown_valid = unknown_arr[valid_mask].tolist()
    equation_str = get_equation_string(popt_list, model_type)
    known_x = np.asarray(known_conc, dtype=float)
    known_y = np.asarray(known_peaks, dtype=float)

    if len(preds_list) > 0:
        all_x = np.concatenate([known_x, np.asarray(preds_list, dtype=float)])
        all_y = np.concatenate([known_y, np.asarray(unknown_valid, dtype=float)])
    else:
        all_x = known_x
        all_y = known_y

    x_min = float(np.nanmin(all_x)) if all_x.size else 0.0
    x_max = float(np.nanmax(all_x)) if all_x.size else 1.0
    y_min = float(np.nanmin(known_y)) if known_y.size else 0.0
    y_max = float(np.nanmax(all_y)) if all_y.size else 1.0

    x_margin = (x_max - x_min) * 0.15 if x_max > x_min else 2
    y_margin = (y_max - y_min) * 0.15 if y_max > y_min else 2

    if model_type in ['mm_origin', 'linear_origin', 'mm_intercept']:
        curve_x_min = 0.0
    else:
        curve_x_min = x_min

    x_range = np.linspace(curve_x_min, x_max + x_margin, 300)
    y_fit = model_func(x_range, *popt)
    y_fit = np.asarray(y_fit, dtype=float)
    y_fit[~np.isfinite(y_fit)] = np.nan

    y_pred_known = model_func(np.array(known_conc, dtype=float), *popt)
    r2 = r2_score(known_peaks, y_pred_known)
    rmse = float(np.sqrt(mean_squared_error(known_peaks, y_pred_known)))

    plt.figure(figsize=(8, 5))
    sns.scatterplot(x=known_conc, y=known_peaks, color='red', label='Known Data')
    sns.lineplot(x=x_range, y=y_fit, color='blue', label='Fitted Curve')
    if len(preds_list) > 0:
        sns.scatterplot(x=preds_list, y=unknown_valid, color='green', marker='X', s=100, label='Predicted')
    plt.xlabel('Amount')
    plt.ylabel('Peak area/height')
    plt.title('Calibration Curve')
    plt.grid(True)
    plt.legend()
    plt.tight_layout()
    plt.xlim(x_min, x_max + x_margin * 1.2)
    plt.ylim(0, y_max + y_margin * 1.2)
    buf = BytesIO()
    plt.savefig(buf, format='png')
    plt.close()
    buf.seek(0)
    plot_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'known_data': {
            'concentrations': list(map(float, known_conc)),
            'peak_areas': list(map(float, known_peaks))
        },
        'predictions': {
            'concentrations': preds_arr[valid_mask].astype(float).tolist(),
            'peak_areas': list(map(float, np.asarray(unknown_valid, dtype=float))),
            'equation': equation_str
        },
        'model_type': model_type,
        'params': popt_list,
        'r2': r2,
        'rmse': rmse,
        'plot_base64': plot_base64
    }
