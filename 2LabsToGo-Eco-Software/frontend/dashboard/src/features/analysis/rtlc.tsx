"use client";

import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";

// ── CSRF helper (same pattern as extractBandApiSlice) ──────────────────────
axios.defaults.withCredentials = true;
axios.defaults.xsrfCookieName = "csrftoken";
axios.defaults.xsrfHeaderName = "X-CSRFToken";

function getCsrfToken(): string {
  return (
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("csrftoken="))
      ?.split("=")[1] ?? ""
  );
}

async function ensureCsrf() {
  try {
    await axios.get("/csrf/", { withCredentials: true });
  } catch (_) {
    /* ignore */
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
interface AnalyzeResult {
  filename: string;
  marked_image_url: string;
  rectangle_centers_x: number[];
  global_top_y: number;
  global_bottom_y: number;
  rectangle_width: number;
  summary: Record<string, any>;
}

interface ExtractResult {
  filename: string;
  num_bands_extracted: number;
  band_urls: string[];
  summary: Record<string, any>;
  output_dir: string;
}

interface ModelInfo {
  name: string;
  path: string;
}

type Step = 1 | 2 | 3;

// ── Component ──────────────────────────────────────────────────────────────
export default function RTLC() {
  // Wizard step
  const [currentStep, setCurrentStep] = useState<Step>(1);

  // Step 1 state
  const [images, setImages] = useState<{ file: File; src: string; id: string }[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResults, setAnalyzeResults] = useState<AnalyzeResult[]>([]);
  const [analyzeErrors, setAnalyzeErrors] = useState<{ filename: string; error: string }[]>([]);
  const [analyzeApiError, setAnalyzeApiError] = useState<string | null>(null);

  // Step 2 state
  const [extracting, setExtracting] = useState(false);
  const [extractResults, setExtractResults] = useState<ExtractResult[]>([]);
  const [extractErrors, setExtractErrors] = useState<{ filename: string; error: string }[]>([]);
  const [extractApiError, setExtractApiError] = useState<string | null>(null);

  // Step 3 state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [dimensions, setDimensions] = useState<2 | 3>(3);
  const [clusterName, setClusterName] = useState<string>("");
  const [clustering, setClustering] = useState(false);
  const [clusterUrl, setClusterUrl] = useState<string | null>(null);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Advanced settings toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Load models when reaching step 3 ──────────────────────────────────
  useEffect(() => {
    if (currentStep === 3 && models.length === 0) {
      setModelsLoading(true);
      axios
        .get("/api/rtlc/list_models/")
        .then((res) => {
          const m = res.data.models || [];
          setModels(m);
          if (m.length > 0 && !selectedModel) {
            setSelectedModel(m[0].path);
          }
        })
        .catch(() => {
          setClusterError("Failed to load available models.");
        })
        .finally(() => setModelsLoading(false));
    }
  }, [currentStep]);

  // ── Step 1: Image upload ──────────────────────────────────────────────
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      const newImages = filesArray.map((file) => ({
        file,
        src: URL.createObjectURL(file),
        id: Math.random().toString(36).substring(7),
      }));
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const removeImage = (idToRemove: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === idToRemove);
      if (img) URL.revokeObjectURL(img.src);
      return prev.filter((i) => i.id !== idToRemove);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    const newImages = files.map((file) => ({
      file,
      src: URL.createObjectURL(file),
      id: Math.random().toString(36).substring(7),
    }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  // ── Step 1: Analyze ───────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (images.length === 0) return;
    setAnalyzing(true);
    setAnalyzeApiError(null);
    setAnalyzeResults([]);
    setAnalyzeErrors([]);

    await ensureCsrf();
    const csrftoken = getCsrfToken();

    const formData = new FormData();
    images.forEach((img) => formData.append("image", img.file));

    try {
      const response = await axios.post("/api/rtlc/analyze_image/", formData, {
        withCredentials: true,
        headers: { "X-CSRFToken": csrftoken },
      });
      setAnalyzeResults(response.data.results || []);
      setAnalyzeErrors(response.data.errors || []);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to analyze images.";
      setAnalyzeApiError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Step 2: Extract Bands ─────────────────────────────────────────────
  const handleExtract = async () => {
    if (images.length === 0) return;
    setExtracting(true);
    setExtractApiError(null);
    setExtractResults([]);
    setExtractErrors([]);

    await ensureCsrf();
    const csrftoken = getCsrfToken();

    const formData = new FormData();
    images.forEach((img) => formData.append("image", img.file));

    try {
      const response = await axios.post("/api/rtlc/extract_bands/", formData, {
        withCredentials: true,
        headers: { "X-CSRFToken": csrftoken },
      });
      setExtractResults(response.data.results || []);
      setExtractErrors(response.data.errors || []);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to extract bands.";
      setExtractApiError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setExtracting(false);
    }
  };

  // ── Step 3: Cluster ───────────────────────────────────────────────────
  const handleCluster = async () => {
    setClustering(true);
    setClusterError(null);
    setClusterUrl(null);

    await ensureCsrf();
    const csrftoken = getCsrfToken();

    // Collect output_dir folder names from extract results
    const folderNames = extractResults
      .map((r) => {
        const parts = r.output_dir.split("/");
        return parts[parts.length - 1] || parts[parts.length - 2];
      })
      .filter(Boolean);

    const name =
      clusterName.trim() ||
      `cluster_${new Date().toISOString().replace(/[:.]/g, "-")}`;

    const payload: Record<string, any> = {
      clustering_dimentions: dimensions,
      clustering_file_name: name,
    };
    if (selectedModel) {
      payload.model_weights_path = selectedModel;
    }
    if (folderNames.length > 0) {
      payload.name_of_images = JSON.stringify(folderNames);
    }

    try {
      const response = await axios.post("/api/rtlc/make_clusters/", payload, {
        withCredentials: true,
        headers: {
          "X-CSRFToken": csrftoken,
          "Content-Type": "application/json",
        },
      });
      if (response.data.cluster_url) {
        setClusterUrl(response.data.cluster_url);
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to perform clustering.";
      setClusterError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setClustering(false);
    }
  };

  // ── Reset wizard ──────────────────────────────────────────────────────
  const resetWizard = () => {
    images.forEach((img) => URL.revokeObjectURL(img.src));
    setImages([]);
    setCurrentStep(1);
    setAnalyzeResults([]);
    setAnalyzeErrors([]);
    setAnalyzeApiError(null);
    setExtractResults([]);
    setExtractErrors([]);
    setExtractApiError(null);
    setClusterUrl(null);
    setClusterError(null);
    setClusterName("");
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col w-full min-h-screen p-4 md:p-6 font-sans">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body pb-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div>
                <h1 className="card-title text-2xl md:text-3xl">
                  RTLC Clustering Analysis
                </h1>
                <p className="text-base-content/60 mt-1 text-sm">
                  Upload TLC plate images → Detect &amp; extract bands →
                  Cluster them in latent space
                </p>
              </div>
              {currentStep > 1 && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={resetWizard}
                >
                  ↻ Start Over
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stepper */}
        <ul className="steps steps-horizontal w-full">
          <li
            className={`step ${currentStep >= 1 ? "step-primary" : ""}`}
            onClick={() => currentStep > 1 && setCurrentStep(1)}
            style={{ cursor: currentStep > 1 ? "pointer" : "default" }}
          >
            Upload &amp; Analyze
          </li>
          <li
            className={`step ${currentStep >= 2 ? "step-primary" : ""}`}
            onClick={() =>
              currentStep > 2 && analyzeResults.length > 0 && setCurrentStep(2)
            }
            style={{
              cursor:
                currentStep > 2 && analyzeResults.length > 0
                  ? "pointer"
                  : "default",
            }}
          >
            Extract Bands
          </li>
          <li className={`step ${currentStep >= 3 ? "step-primary" : ""}`}>
            Cluster
          </li>
        </ul>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 1: Upload & Analyze                                       */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {currentStep === 1 && (
          <div className="space-y-4">
            {/* Upload area */}
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h2 className="card-title text-lg">
                  Step 1 — Upload &amp; Analyze
                </h2>
                <p className="text-sm text-base-content/60 mb-3">
                  Upload one or more TLC plate images. The backend will detect
                  bands and return a marked preview.
                </p>

                {/* Drop zone */}
                <label
                  htmlFor="dropzone-file"
                  className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-base-300 rounded-xl cursor-pointer bg-base-200/40 hover:bg-base-200 transition-colors"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div className="flex flex-col items-center justify-center py-6">
                    <svg
                      className="w-8 h-8 mb-3 text-base-content/40"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 20 16"
                    >
                      <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
                      />
                    </svg>
                    <p className="mb-1 text-sm text-base-content/60">
                      <span className="font-semibold text-primary">
                        Click to upload
                      </span>{" "}
                      or drag and drop
                    </p>
                    <p className="text-xs text-base-content/40">
                      PNG, JPG, JPEG, TIF (multiple files)
                    </p>
                  </div>
                  <input
                    id="dropzone-file"
                    type="file"
                    className="hidden"
                    multiple
                    accept="image/*"
                    onChange={handleImageChange}
                  />
                </label>

                {/* Image previews */}
                {images.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold mb-2">
                      Uploaded Images ({images.length})
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {images.map((img) => (
                        <div
                          key={img.id}
                          className="relative group w-20 h-20 rounded-lg overflow-hidden border border-base-300 bg-base-200"
                        >
                          <img
                            src={img.src}
                            alt={img.file.name}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              onClick={() => removeImage(img.id)}
                              className="btn btn-circle btn-xs btn-error"
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5">
                            <p className="text-[10px] text-white truncate">
                              {img.file.name}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Advanced Settings */}
                <div className="mt-3">
                  <button
                    className="btn btn-ghost btn-xs gap-1"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M6 6L14 10L6 14V6Z" />
                    </svg>
                    Advanced Settings
                  </button>
                  {showAdvanced && (
                    <div className="mt-2 p-3 bg-base-200 rounded-lg">
                      <p className="text-xs text-base-content/50 mb-2">
                        Optional overrides for band detection. Leave empty for
                        automatic detection.
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {[
                          "num_bands",
                          "first_app_position",
                          "edge_cut",
                          "migration_front",
                          "band_spacing",
                          "band_width",
                        ].map((field) => (
                          <div key={field}>
                            <label className="label py-0">
                              <span className="label-text text-xs">
                                {field.replace(/_/g, " ")}
                              </span>
                            </label>
                            <input
                              type="number"
                              className="input input-bordered input-xs w-full"
                              placeholder="auto"
                              step="any"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Analyze button */}
                <div className="card-actions justify-end mt-4">
                  <button
                    className={`btn btn-primary ${analyzing ? "loading" : ""}`}
                    onClick={handleAnalyze}
                    disabled={images.length === 0 || analyzing}
                  >
                    {analyzing && (
                      <span className="loading loading-spinner loading-sm"></span>
                    )}
                    {analyzing ? "Analyzing…" : "Analyze Images"}
                  </button>
                </div>
              </div>
            </div>

            {/* API error */}
            {analyzeApiError && (
              <div className="alert alert-error shadow-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="stroke-current shrink-0 h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{analyzeApiError}</span>
              </div>
            )}

            {/* Analyze results */}
            {analyzeResults.length > 0 && (
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body">
                  <h3 className="card-title text-base">
                    Analysis Results ({analyzeResults.length} image
                    {analyzeResults.length > 1 ? "s" : ""})
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    {analyzeResults.map((result, idx) => (
                      <div
                        key={idx}
                        className="border border-base-300 rounded-lg p-3"
                      >
                        <p className="text-sm font-semibold mb-2 truncate">
                          {result.filename}
                        </p>
                        <img
                          src={result.marked_image_url}
                          alt={`Marked ${result.filename}`}
                          className="w-full rounded-md border border-base-200 mb-2"
                        />
                        <div className="text-xs text-base-content/60 space-y-0.5">
                          <p>
                            Bands detected:{" "}
                            <span className="font-medium text-base-content">
                              {result.rectangle_centers_x?.length || 0}
                            </span>
                          </p>
                          {result.summary?.band_spacing != null && (
                            <p>
                              Band spacing:{" "}
                              <span className="font-medium text-base-content">
                                {Number(result.summary.band_spacing).toFixed(1)}
                                px
                              </span>
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {analyzeErrors.length > 0 && (
                    <div className="alert alert-warning mt-3 text-sm">
                      <span>
                        {analyzeErrors.length} image(s) failed to analyze.
                      </span>
                    </div>
                  )}

                  <div className="card-actions justify-end mt-4">
                    <button
                      className="btn btn-primary"
                      onClick={() => setCurrentStep(2)}
                    >
                      Next → Extract Bands
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 2: Extract Bands                                          */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h2 className="card-title text-lg">
                  Step 2 — Extract Bands
                </h2>
                <p className="text-sm text-base-content/60 mb-3">
                  Extract individual band images from the detected regions.
                  These will be saved server-side for clustering.
                </p>

                <div className="bg-base-200 rounded-lg p-3 mb-3">
                  <p className="text-sm">
                    <span className="font-semibold">
                      {images.length} image(s)
                    </span>{" "}
                    ready for band extraction
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {images.map((img) => (
                      <span key={img.id} className="badge badge-outline badge-sm">
                        {img.file.name}
                      </span>
                    ))}
                  </div>
                </div>

                {extractResults.length === 0 && (
                  <div className="card-actions justify-end">
                    <button
                      className="btn btn-ghost"
                      onClick={() => setCurrentStep(1)}
                    >
                      ← Back
                    </button>
                    <button
                      className={`btn btn-primary ${extracting ? "loading" : ""}`}
                      onClick={handleExtract}
                      disabled={extracting}
                    >
                      {extracting && (
                        <span className="loading loading-spinner loading-sm"></span>
                      )}
                      {extracting ? "Extracting…" : "Extract Bands"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* API error */}
            {extractApiError && (
              <div className="alert alert-error shadow-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="stroke-current shrink-0 h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{extractApiError}</span>
              </div>
            )}

            {/* Extract results */}
            {extractResults.length > 0 && (
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body">
                  <h3 className="card-title text-base">
                    Extracted Bands
                  </h3>
                  <div className="space-y-4 mt-2">
                    {extractResults.map((result, idx) => (
                      <div
                        key={idx}
                        className="border border-base-300 rounded-lg p-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold truncate">
                            {result.filename}
                          </p>
                          <span className="badge badge-primary badge-sm">
                            {result.num_bands_extracted} band
                            {result.num_bands_extracted !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {result.band_urls.map((url, bIdx) => (
                            <div
                              key={bIdx}
                              className="w-16 h-24 rounded-md overflow-hidden border border-base-300 bg-base-200"
                            >
                              <img
                                src={url}
                                alt={`Band ${bIdx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-base-content/50 mt-2">
                          Saved to: {result.output_dir}
                        </p>
                      </div>
                    ))}
                  </div>

                  {extractErrors.length > 0 && (
                    <div className="alert alert-warning mt-3 text-sm">
                      <span>
                        {extractErrors.length} image(s) failed extraction.
                      </span>
                    </div>
                  )}

                  <div className="card-actions justify-end mt-4">
                    <button
                      className="btn btn-ghost"
                      onClick={() => setCurrentStep(1)}
                    >
                      ← Back
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => setCurrentStep(3)}
                    >
                      Next → Cluster
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 3: Cluster                                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h2 className="card-title text-lg">Step 3 — Cluster</h2>
                <p className="text-sm text-base-content/60 mb-4">
                  Run KMeans clustering on the extracted bands using an
                  autoencoder model. The results are visualized as an
                  interactive PCA scatter plot.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Model selector */}
                  <div className="form-control w-full">
                    <label className="label">
                      <span className="label-text font-semibold">
                        Model Weights
                      </span>
                    </label>
                    {modelsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-base-content/60">
                        <span className="loading loading-spinner loading-xs"></span>
                        Loading models…
                      </div>
                    ) : models.length > 0 ? (
                      <select
                        className="select select-bordered w-full"
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                      >
                        {models.map((m) => (
                          <option key={m.path} value={m.path}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="alert alert-warning text-sm py-2">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="stroke-current shrink-0 h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                        <span>
                          No model weights found in <code>app/models/</code>.
                          Add a <code>.pkl</code> or <code>.pth</code> file.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Dimensions */}
                  <div className="form-control w-full">
                    <label className="label">
                      <span className="label-text font-semibold">
                        PCA Dimensions
                      </span>
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="dims"
                          className="radio radio-primary radio-sm"
                          checked={dimensions === 3}
                          onChange={() => setDimensions(3)}
                        />
                        <span className="text-sm">3D</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="dims"
                          className="radio radio-primary radio-sm"
                          checked={dimensions === 2}
                          onChange={() => setDimensions(2)}
                        />
                        <span className="text-sm">2D</span>
                      </label>
                    </div>
                  </div>

                  {/* Cluster name */}
                  <div className="form-control w-full">
                    <label className="label">
                      <span className="label-text font-semibold">
                        Cluster Name
                      </span>
                      <span className="label-text-alt text-base-content/40">
                        Optional
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      placeholder="Auto-generated if empty"
                      value={clusterName}
                      onChange={(e) => setClusterName(e.target.value)}
                    />
                  </div>

                  {/* Folders summary */}
                  <div className="form-control w-full">
                    <label className="label">
                      <span className="label-text font-semibold">
                        Band Folders
                      </span>
                    </label>
                    <div className="text-sm text-base-content/60">
                      {extractResults.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {extractResults.map((r, i) => {
                            const parts = r.output_dir.split("/");
                            const folderName =
                              parts[parts.length - 1] ||
                              parts[parts.length - 2];
                            return (
                              <span
                                key={i}
                                className="badge badge-outline badge-sm"
                              >
                                {folderName}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-base-content/40 italic">
                          All folders in extracted_bands/ will be used
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="card-actions justify-end mt-6">
                  <button
                    className="btn btn-ghost"
                    onClick={() => setCurrentStep(2)}
                  >
                    ← Back
                  </button>
                  <button
                    className={`btn btn-primary ${clustering ? "loading" : ""}`}
                    onClick={handleCluster}
                    disabled={clustering || (models.length === 0 && !modelsLoading)}
                  >
                    {clustering && (
                      <span className="loading loading-spinner loading-sm"></span>
                    )}
                    {clustering ? "Clustering…" : "Run Clustering"}
                  </button>
                </div>
              </div>
            </div>

            {/* Cluster error */}
            {clusterError && (
              <div className="alert alert-error shadow-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="stroke-current shrink-0 h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{clusterError}</span>
              </div>
            )}

            {/* Cluster result — Plotly iframe */}
            {clusterUrl && (
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body">
                  <div className="flex items-center justify-between">
                    <h3 className="card-title text-base">
                      Clustering Result
                    </h3>
                    <a
                      href={clusterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-xs gap-1"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                      Open in new tab
                    </a>
                  </div>
                  <div className="w-full mt-2 rounded-lg overflow-hidden border border-base-300">
                    <iframe
                      src={clusterUrl}
                      title="Clustering Visualization"
                      className="w-full border-0"
                      style={{ height: "650px" }}
                      sandbox="allow-scripts allow-same-origin"
                    />
                  </div>
                  <div className="alert alert-success mt-3 text-sm">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="stroke-current shrink-0 h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>
                      Clustering complete! Hover over points to see image
                      names. Colors represent cluster assignments.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
