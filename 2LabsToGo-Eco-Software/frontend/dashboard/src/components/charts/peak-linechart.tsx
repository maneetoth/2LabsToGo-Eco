import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, Ref, useMemo } from "react";
import * as d3 from "d3";
import { detectPeaks, DataPoint, PeakDetectionParams, validatePeakSelection, PeakData, PeakBand } from "@/utils/peakDetection";
import { PencilSquareIcon, CheckIcon,TrashIcon } from '@heroicons/react/24/solid';
import { ChartPeak, ChangeAreaItem } from "@/types/peakApi";

// API-based peak type for the chart
export interface ApiPeakForChart {
  x: number;       // peak_x
  y: number;       // peak_height
  startX: number;  // start_end[0]
  endX: number;    // start_end[1]
  area: number;
}

// Info about a peak area change for API call
export interface PeakAreaChangeInfo {
  bandKey: string;
  channelName: string;
  peakIndex: number;  // Index of the peak (based on x position)
  peakX: number;      // Original peak x position
  newStart: number;
  newEnd: number;
}

interface D3InteractiveChartProps {
  data: DataPoint[];
  lineColor?: string;
  fillColor?: string;
  bandstep?: number;
  onPeaksChange?: (peaks: DataPoint[]) => void;
onRegionsChange?: (regions: { x0: number; x1: number; area?: number; channel?: string }[]) => void;
  // Callback when user confirms peak area edit (tick button clicked)
  onPeakAreaChange?: (changeInfo: PeakAreaChangeInfo) => void;

  selectedPeakRef?: React.MutableRefObject<{ [channelName: string]: DataPoint[] }>;
  channelName?: string;
  peakParams?: PeakDetectionParams;
  allPeaks?: PeakBand;
  // New props for API-based peaks
  apiPeaks?: ChartPeak[];  // Peaks from API response for this channel
  useApiPeaks?: boolean;   // Flag to use API peaks instead of client-side detection
}

export interface D3InteractiveChartHandle {
  getSelectedPeak: () => { [channelName: string]: DataPoint[] };
  clearSelectedPeak: () => void;
}

const D3InteractiveChart = forwardRef(function D3InteractiveChart(
  {
    data,
    lineColor = "line",
    fillColor = "rgba(70,130,180,0.3)",
    onPeaksChange,
    onRegionsChange,
    onPeakAreaChange,
    bandstep,
    channelName,
    selectedPeakRef,
    peakParams,
    allPeaks,
    apiPeaks,
    useApiPeaks = false,
  }: D3InteractiveChartProps,
  ref: Ref<D3InteractiveChartHandle>
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [editPeak, setEditPeak] = useState(false);
  // Track original region states when editing starts (all regions)
  const [editingRegionsOriginal, setEditingRegionsOriginal] = useState<
    { x0: number; x1: number; peakX: number }[] | null
  >(null);
const [regions, setRegions] = useState<
  { x0: number; x1: number; area?: number; channel?: string }[]
>([]);

  const zoomTransform = useRef<d3.ZoomTransform | null>(null); // <-- Add this
  const [selectedRegionIdx, setSelectedRegionIdx] = useState<number | null>(null);
  const [selectedPeakIdx, setSelectedPeakIdx] = useState<number | null>(null);
  const [selectedPeak, setSelectedPeak] = useState<DataPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peaksState, setPeaksState] = useState<DataPoint[]>([]);

  const onRegionsChangeRef = useRef(onRegionsChange);

// Keep in sync if parent redefines the function (rarely happens)
useEffect(() => {
  onRegionsChangeRef.current = onRegionsChange;
}, [onRegionsChange]);


  useEffect(() => {
    if (selectedPeakRef && channelName && selectedPeak !== null) {
      selectedPeakRef.current[channelName] = [selectedPeak];
    }
  console.log('selected peak', selectedPeak)
}, [selectedPeak, selectedPeakRef, channelName]);

// console.log("*******************",peakParams.minPeakHeight);
// Optional: expose a public API using `ref`
useImperativeHandle(ref, () => ({
  getSelectedPeak: () => {
    return {
      [channelName ?? "unknown"]: selectedPeak ? [selectedPeak] : [],
    };
  },
  clearSelectedPeak: () => {
    setSelectedPeak(null);
    setSelectedPeakIdx(null);
  },
}));

  let preprocessedData = data
  
  const defaultParams: PeakDetectionParams = useMemo(() => ({
    minIncreasingSteps: 5,
    minDecreasingSteps: 5,
    minPeakHeight: 0.4,
    hrfRange: [0, 1000],
  }), []);

  // Client-side detected peaks (fallback) - COMMENTED OUT: using API only
  // const detectedPeaks = useMemo(
  //   () => detectPeaks(preprocessedData, peakParams ?? defaultParams),
  //   [preprocessedData, peakParams, defaultParams]
  // );
  const detectedPeaks = useMemo<DataPoint[]>(() => [], []); // Empty - API only mode

  // Convert API peaks to DataPoint format for rendering
  const apiPeaksAsDataPoints = useMemo<DataPoint[]>(() => {
    if (!apiPeaks || apiPeaks.length === 0) return [];
    return apiPeaks.map(p => ({ x: p.x, y: p.y }));
  }, [apiPeaks]);

  // Use API peaks only - fallback disabled
  const effectivePeaks = useMemo(() => {
    // Always use API peaks when available
    if (apiPeaks && apiPeaks.length > 0) {
      console.log(`[D3Chart] Using ${apiPeaks.length} API peaks for ${channelName}`);
      return apiPeaksAsDataPoints;
    }
    // No fallback - return empty if no API peaks
    console.log(`[D3Chart] No API peaks available for ${channelName}`);
    return [];
  }, [apiPeaks, apiPeaksAsDataPoints, channelName]);

  const peaks = effectivePeaks;
  console.log("pre:", preprocessedData);
  
  // console.log(fillColor);
  console.log('peaks',peaks);
  console.log("---------------------");
  console.log('detectedPeaks (client-side)',detectedPeaks);
  console.log('apiPeaks (from server)', apiPeaks);
  console.log("---------------------");
  console.log('all peaks',allPeaks);
  


useEffect(() => {
  if (!svgRef.current || !preprocessedData.length) return;

  const svg = d3.select(svgRef.current);

  // Remove chart/axes, keep overlays/handles/brush
  svg.selectAll("g:not(.highlighted-areas):not(.handles-group):not(.brush)").remove();

  const margin = { top: 20, right: 30, bottom: 30, left: 50 };
  const width = 800 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // --- X scale ---
  const x = d3.scaleLinear()
    .domain(d3.extent(preprocessedData, d => d.x) as [number, number])
    .range([0, width]);

  // --- Y scale (dynamic, supports negatives) ---
  const yDataMin = d3.min(preprocessedData, d => d.y) ?? 0;
  const yDataMax = d3.max(preprocessedData, d => d.y) ?? 1;

  // padding around data range
  const pad = Math.max(1e-9, (yDataMax - yDataMin || 1) * 0.05);
  const minY = yDataMin - pad;
  const maxY = yDataMax + pad;

  const y = d3.scaleLinear()
    .domain([minY, maxY])
    .nice()
    .range([height, 0]);

  // Save for later (overlays, interactions)
  (svgRef.current as any).__d3 = { x, y, margin, width, height };

  // --- Area & line: fill UNDER curve down to the lowest y in the data ---
  const baselineY = y(yDataMin);

  const area = d3.area<DataPoint>()
    .x(d => x(d.x))
    .y0(baselineY)     // always fills down to min data value
    .y1(d => y(d.y));

  const line = d3.line<DataPoint>()
    .x(d => x(d.x))
    .y(d => y(d.y));

  g.append("path")
    .datum(preprocessedData)
    .attr("fill", fillColor)
    .attr("d", area);

  g.append("path")
    .datum(preprocessedData)
    .attr("stroke", lineColor)
    .attr("fill", "none")
    .attr("stroke-width", 2)
    .attr("d", line);

  // --- Axes ---
  let xAxis = g.select<SVGGElement>(".x-axis");
  if (xAxis.empty()) {
    xAxis = g.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height})`);
  }
  xAxis.call(d3.axisBottom(x));

  let yAxis = g.select<SVGGElement>(".y-axis");
  if (yAxis.empty()) yAxis = g.append("g").attr("class", "y-axis");
  yAxis.call(d3.axisLeft(y));

  // Optional: zero reference line when visible
  if (minY <= 0 && 0 <= maxY) {
    g.append("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", y(0)).attr("y2", y(0))
      .attr("stroke", "#888")
      .attr("stroke-dasharray", "4,4");
  }

  // Ensure overlay groups exist once
  if (svg.select(".highlighted-areas").empty()) g.append("g").attr("class", "highlighted-areas");
  if (svg.select(".handles-group").empty()) g.append("g").attr("class", "handles-group");
  if (svg.select(".brush").empty()) g.append("g").attr("class", "brush");

  // --- Zoom (x-only) ---
  svg.call(
    d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([[0, 0], [width, height]])
      .on("zoom", (event) => {
        zoomTransform.current = event.transform;

        const newX = event.transform.rescaleX(x);

        // Update X axis
        g.select<SVGGElement>(".x-axis").call(d3.axisBottom(newX));

        // Update paths with new X scale; baseline stays at y(min data)
        g.select("path") // area path
          .attr("d", area.x(d => newX(d.x))(preprocessedData));
        g.select("path + path") // line path
          .attr("d", line.x(d => newX(d.x))(preprocessedData));

        // Trigger overlays redraw
        setRegions(r => [...r]);
      })
  );
}, [data, lineColor, fillColor, preprocessedData]);


 // Only re-run if data or color changes
useEffect(() => {
  setRegions([]);
}, [data]);
  // Add detected peaks as editable regions on mount or when peaks change
  useEffect(() => {
    // Bail out if we’ve already initialized regions
    if (regions.length > 0) return;

    if (peaks.length > 0) {
      // If using API peaks, use the start_end bounds from the API
      if (apiPeaks && apiPeaks.length > 0) {
        const newRegions = apiPeaks
          .map(peak => ({
            x0: peak.startX,
            x1: peak.endX,
            area: peak.area,
            channel: channelName ?? "unknown",
          }))
          .filter((r) => r.x0 !== undefined && r.x1 !== undefined);
        
        console.log(`[D3Chart] Initializing ${newRegions.length} regions from API for ${channelName}`);
        setRegions(newRegions);
        setPeaksState(apiPeaksAsDataPoints);
      }
      // COMMENTED OUT: Fallback to client-side calculation - using API only
      // else {
      //   const minSteps = (peakParams ?? defaultParams).minIncreasingSteps;
      //   const newRegions = peaks
      //     .map(peak => {
      //       const idx = preprocessedData.findIndex(d => d.x === peak.x && d.y === peak.y);
      //       if (idx === -1) return null;
      //       const left  = Math.max(idx - minSteps, 0);
      //       const right = Math.min(idx + minSteps, preprocessedData.length - 1);
      //       return { x0: preprocessedData[left].x, x1: preprocessedData[right].x };
      //     })
      //     .filter((r): r is { x0: number; x1: number } => Boolean(r));
      //
      //   setRegions(newRegions);
      //   setPeaksState(detectedPeaks);
      // }
    }
  }, [detectedPeaks, preprocessedData, regions.length, peakParams, defaultParams, peaks, useApiPeaks, apiPeaks, apiPeaksAsDataPoints, channelName]);

  // Reset peaksState when API peaks change - API only mode
  useEffect(() => {
    if (apiPeaks && apiPeaks.length > 0) {
      setPeaksState(apiPeaksAsDataPoints);
    }
    // COMMENTED OUT: Fallback - using API only
    // else {
    //   setPeaksState(detectedPeaks);
    // }
    // Do not clear regions here to avoid wiping user selections unnecessarily
  }, [apiPeaks, apiPeaksAsDataPoints]);


  useEffect(() => {
    if (!svgRef.current || !preprocessedData.length) return;
  
    const svg = d3.select(svgRef.current);
    const { x, y, width, height } = (svgRef.current as any).__d3;
    const newX = zoomTransform.current ? zoomTransform.current.rescaleX(x) : x;
  
    const g = svg.select("g");
    const highlightedAreasGroup = g.select<SVGGElement>(".highlighted-areas");
    const handlesGroup = g.select<SVGGElement>(".handles-group");
    const brushGroup = g.select<SVGGElement>(".brush");
    const handleRadius = 6;
  
    highlightedAreasGroup.selectAll("*").remove();
    handlesGroup.selectAll("*").remove();
  
    // 🔁 Render user-defined regions
    regions.forEach((region, idx) => {
      const { x0, x1 } = region;
      const regionData = preprocessedData.filter(d => d.x >= x0 && d.x <= x1);
      if (!regionData.length) return;

      // --- Calculate area under the curve for this region (for logging only) ---
      let area = 0;
      for (let i = 1; i < regionData.length; i++) {
        const xPrev = regionData[i - 1].x;
        const xCurr = regionData[i].x;
        const yPrev = regionData[i - 1].y;
        const yCurr = regionData[i].y;
        area += ((yPrev + yCurr) / 2) * (xCurr - xPrev);
      }

      console.log(`🟢 Region ${idx}: [${x0.toFixed(2)}, ${x1.toFixed(2)}], Area = ${area.toFixed(4)}`);
  
      // const maxPoint = regionData.reduce((a, b) => (a.y > b.y ? a : b), regionData[0]);
      // const peakWithChannel = { ...maxPoint, channel: channelName ?? "unknown" };
      // const isValid = validatePeakSelection(
      //   allPeaks ?? { [channelName ?? "unknown"]: peaks },
      //   peakWithChannel,
      //   150
      // );
      // if (!isValid) return;
  
      const interpolateY = (xVal: number) => {
        const i = d3.bisector((d: DataPoint) => d.x).left(preprocessedData, xVal);
        const d0 = preprocessedData[i - 1];
        const d1 = preprocessedData[i];
        if (!d0 || !d1) return 0;
        const t = (xVal - d0.x) / (d1.x - d0.x);
        return d0.y * (1 - t) + d1.y * t;
      };
  
      const startY = interpolateY(x0);
      const endY = interpolateY(x1);
  
      const clippedData: DataPoint[] = [
        { x: x0, y: startY },
        ...preprocessedData.filter(d => d.x > x0 && d.x < x1),
        { x: x1, y: endY },
      ];
  
      highlightedAreasGroup.append("path")
        .datum(clippedData)
        .attr("fill", idx === selectedRegionIdx ? "orange" : "red")
        .attr("opacity", idx === selectedRegionIdx ? 0.7 : 0.5)
        .attr("cursor", "pointer")
        .attr("d", d3.area<DataPoint>().x(d => newX(d.x)).y0(height).y1(d => y(d.y)))
        .style("pointer-events", "all")
        .on("click", (event) => {
          event.stopPropagation();
          setSelectedRegionIdx(idx);
        });
  
      if (editPeak) {
        // Left handle
        (handlesGroup.append("circle") as d3.Selection<SVGCircleElement, unknown, null, undefined>)
        .attr("cx", newX(x0))
        .attr("cy", y(startY))
        .attr("r", handleRadius)
        .attr("fill", idx === selectedRegionIdx ? "orange" : "red")
        .style("cursor", "ew-resize")
        .style("pointer-events", "all")
        .call(d3.drag<SVGCircleElement, unknown>().on("drag", (event) => {
          const newX0 = newX.invert(event.x);
          setRegions(regions => {
            const updated = [...regions];
            updated[idx] = { x0: newX0, x1: updated[idx].x1 };
            return updated;
          });
        }));
      
      (handlesGroup.append("circle") as d3.Selection<SVGCircleElement, unknown, null, undefined>)
        .attr("cx", newX(x1))
        .attr("cy", y(endY))
        .attr("r", handleRadius)
        .attr("fill", idx === selectedRegionIdx ? "orange" : "red")
        .style("cursor", "ew-resize")
        .style("pointer-events", "all")
        .call(d3.drag<SVGCircleElement, unknown>().on("drag", (event) => {
          const newX1 = newX.invert(event.x);
          setRegions(regions => {
            const updated = [...regions];
            updated[idx] = { x0: updated[idx].x0, x1: newX1 };
            return updated;
          });
        }));
      }
    });
  
    // 🔁 Render validated peaks
    peaks.forEach((peak, idx) => {
      // const peakWithChannel = { ...peak, channel: channelName ?? "unknown" };
      // if (!validatePeakSelection(allPeaks ?? { [channelName ?? "unknown"]: peaks }, peakWithChannel, 150)) return;
  
      const peakIdx = preprocessedData.findIndex(d => d.x === peak.x && d.y === peak.y);
      if (peakIdx === -1) return;
  
      const leftIdx = Math.max(peakIdx - 5, 0);
      const rightIdx = Math.min(peakIdx + 5, preprocessedData.length - 1);
      const areaData = [
        { x: preprocessedData[leftIdx].x, y: preprocessedData[leftIdx].y },
        ...preprocessedData.slice(leftIdx + 1, rightIdx),
        { x: preprocessedData[rightIdx].x, y: preprocessedData[rightIdx].y },
      ];
  
      highlightedAreasGroup.append("line")
        .attr("x1", newX(peak.x))
        .attr("x2", newX(peak.x))
        .attr("y1", y(peak.y))
        .attr("y2", height)
        .attr("stroke", idx === selectedPeakIdx ? "orange" : "gold")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "6,4")
        .attr("opacity", 0.9)
        .style("cursor", "pointer")
        .on("click", (event) => {
          event.stopPropagation();
          setSelectedPeakIdx(idx);
          setSelectedPeak(peak);
        });
  
      highlightedAreasGroup.append("circle")
        .attr("cx", newX(peak.x))
        .attr("cy", y(peak.y))
        .attr("r", 6)
        .attr("fill", idx === selectedPeakIdx ? "orange" : "gold")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .style("cursor", "pointer")
        .on("click", (event) => {
          event.stopPropagation();
          setSelectedPeakIdx(idx);
          setSelectedPeak(peak);
        });
    });
  
    // Deselect on background click
    svg.on("click", () => setSelectedRegionIdx(null));
  
    // 🖌️ Brush (only when not editing)
    brushGroup.selectAll("*").remove();
    if (!editPeak) {
      const brush = d3.brushX()
        .extent([[0, 0], [width, height]])
        .on("end", (event) => {
          const selection = event.selection;
          if (!selection) return;
  
          const [x0, x1] = selection.map(newX.invert);
          const regionData = preprocessedData.filter(d => d.x >= x0 && d.x <= x1);
          if (regionData.length === 0) return;
  
          const maxPoint = regionData.reduce((a, b) => (a.y > b.y ? a : b));
          setPeaksState(peaks => [...peaks, maxPoint]);
          setRegions(regions => [...regions, { x0, x1 }]);
  
          // OPTIONAL: update selectedPeakRef here
          if (channelName && selectedPeakRef?.current) {
            Object.keys(selectedPeakRef.current).forEach(ch => {
              if (!Array.isArray(selectedPeakRef.current[ch])) {
                selectedPeakRef.current[ch] = [];
              }
              selectedPeakRef.current[ch].push({
                ...maxPoint,
                channel: ch,
                track: bandstep,
              });
            });
          }
  
          brushGroup.call(brush.move, null); // clear brush
        });
  
      brushGroup.call(brush);

//       // ✅ Notify parent about all regions with their areas
// if (onRegionsChange) {
//   const regionsWithAreas = regions.map(r => ({
//     ...r,
//     channel: channelName ?? "unknown",
//   }));
//   onRegionsChange(regionsWithAreas);
// }

// ✅ Optionally, sync to selectedPeakRef (like peaks

    }
  
  }, [editPeak, preprocessedData, regions, selectedRegionIdx, selectedPeakIdx, channelName, peaks, allPeaks, selectedPeakRef, bandstep]);
  
  // Compute areas for regions whenever regions change (boundaries only, not area itself)
  useEffect(() => {
    if (regions.length === 0) return;

    const needsUpdate = regions.some(r => r.area === undefined);
    if (!needsUpdate) return;

    const updatedRegions = regions.map((region, idx) => {
      if (region.area !== undefined) return region;

      const { x0, x1 } = region;
      const regionData = preprocessedData.filter(d => d.x >= x0 && d.x <= x1);
      
      if (regionData.length < 2) {
        return { ...region, area: 0, channel: channelName ?? "unknown" };
      }

      let area = 0;
      for (let i = 1; i < regionData.length; i++) {
        const xPrev = regionData[i - 1].x;
        const xCurr = regionData[i].x;
        const yPrev = regionData[i - 1].y;
        const yCurr = regionData[i].y;
        area += ((yPrev + yCurr) / 2) * (xCurr - xPrev);
      }

      console.log(`📊 Computed area for Region ${idx} [Channel: ${channelName ?? "unknown"}] [${x0.toFixed(2)}, ${x1.toFixed(2)}]: Area = ${area.toFixed(4)}`);
      return { ...region, area, channel: channelName ?? "unknown" };
    });

    // Guard: only update state if something actually changed (prevent needless rerender cascade)
    const changed = updatedRegions.some((r, i) => {
      const prev = regions[i];
      return prev.area !== r.area || prev.x0 !== r.x0 || prev.x1 !== r.x1 || prev.channel !== r.channel;
    });
    if (changed) {
      setRegions(updatedRegions);
    }
  }, [regions, preprocessedData, channelName]);

  // 🔄 Notify parent *only when regions actually change* (debounced via signature ref)
const prevRegionsRef = useRef<
  { x0: number; x1: number; area?: number; channel?: string }[]
>([]);
const lastSentSignatureRef = useRef<string>("");

// Build a stable signature rounding area to reduce floating-point micro differences triggering updates
const buildSignature = (regs: { x0: number; x1: number; area?: number; channel?: string }[]) =>
  regs.map(r => `${r.channel}:${r.x0}:${r.x1}:${Math.round((r.area ?? 0) * 1e6)}`).join("|");

useEffect(() => {
  if (!onRegionsChangeRef.current) return;

  const signature = buildSignature(regions);
  if (signature === lastSentSignatureRef.current) return;

  // Log all region areas
  if (regions.length > 0) {
    console.log('All region areas:', regions.map((r, i) => ({
      idx: i,
      channel: r.channel ?? channelName ?? 'unknown',
      x0: r.x0,
      x1: r.x1,
      area: r.area
    })));
  }

  // Defer dispatch slightly to allow multiple rapid region boundary drags to coalesce
  const regionsWithAreas = regions.map(r => ({
    ...r,
    channel: channelName ?? "unknown",
  }));

  lastSentSignatureRef.current = signature;
  prevRegionsRef.current = regions;
  // Use requestAnimationFrame to batch with paint
  requestAnimationFrame(() => {
    onRegionsChangeRef.current && onRegionsChangeRef.current(regionsWithAreas);
  });
}, [regions, channelName]);


  return (
    <div>
      <button onClick={() => {
        setEditPeak(e => {
          const next = !e;
          
          if (next) {
            // Starting edit mode - save ALL original region states
            const originals = regions.map((region, idx) => {
              const peakInRegion = peaksState.find(p => p.x >= region.x0 && p.x <= region.x1);
              return {
                x0: region.x0,
                x1: region.x1,
                peakX: peakInRegion?.x ?? region.x0,
              };
            });
            setEditingRegionsOriginal(originals);
            console.log('[D3Chart] Entering edit mode, saved original regions:', originals);
          } else {
            // Finishing edit mode - check ALL regions for changes and call API for each changed one
            console.log('[D3Chart] Exiting edit mode, checking for changes...');
            console.log('[D3Chart] Original regions:', editingRegionsOriginal);
            console.log('[D3Chart] Current regions:', regions);
            
            if (editingRegionsOriginal && onPeakAreaChange && bandstep !== undefined && channelName) {
              regions.forEach((currentRegion, idx) => {
                const original = editingRegionsOriginal[idx];
                if (!original) return;
                
                const hasChanged = 
                  Math.round(currentRegion.x0) !== Math.round(original.x0) || 
                  Math.round(currentRegion.x1) !== Math.round(original.x1);
                
                if (hasChanged) {
                  console.log(`[D3Chart] Region ${idx} changed: [${original.x0}, ${original.x1}] -> [${currentRegion.x0}, ${currentRegion.x1}]`);
                  
                  // Find the peak index based on position in apiPeaks
                  const peakIndex = apiPeaks?.findIndex(p => 
                    Math.abs(p.x - original.peakX) < 1
                  ) ?? idx;
                  
                  // Pass the peak's x-value as peakIndex (API expects peak_x here)
                  onPeakAreaChange({
                    bandKey: String(bandstep),
                    channelName: channelName,
                    peakIndex: original.peakX,
                    peakX: original.peakX,
                    newStart: Math.round(currentRegion.x0),
                    newEnd: Math.round(currentRegion.x1),
                  });
                }
              });
            }
            // Clear the editing state
            setEditingRegionsOriginal(null);
          }
          
          // Force overlays/handles update immediately
          setRegions(r => [...r]);
          return next;
        });
      }}>
       {editPeak ? (
    <>
      <CheckIcon className="w-5 h-5 text-green-600" />
      {/* <span>Finish Editing Peak</span> */}
    </>
  ) : (
    <>
      <PencilSquareIcon className="w-5 h-5 text-blue-600" />
      {/* <span>Edit Peak</span> */}
    </>
  )}
      </button>
      <button
        onClick={() => {
          if (selectedRegionIdx !== null) {
            setRegions(regions => {
              const regionToDelete = regions[selectedRegionIdx];
              // Remove peaks whose x is inside the deleted region
              setPeaksState(peaks =>
                peaks.filter(
                  peak => !(peak.x >= regionToDelete.x0 && peak.x <= regionToDelete.x1)
                )
              );
              return regions.filter((_, idx) => idx !== selectedRegionIdx);
            });
            setSelectedRegionIdx(null);
          }
        }}
        disabled={selectedRegionIdx === null}
        style={{ marginLeft: 8 }}
      >
       {editPeak ? <TrashIcon className="w-5 h-5 text-red-600" /> : null}
        {/* <span>Delete Selected Region</span> */}
      </button>
     
      <svg ref={svgRef} width={600} height={400}></svg>
      {/* Optionally show selected peak info */}
      {selectedPeak && (
        <div style={{ marginTop: 8 }}>
          <span className="font-bold">Selected Peak:</span>{" "}
          x: {selectedPeak.x}, y: {selectedPeak.y}
        </div>
      )}
    </div>
  )
});


// Memoize to prevent unnecessary re-renders when parent supplies stable props
const MemoizedD3InteractiveChart = React.memo(D3InteractiveChart);
export default MemoizedD3InteractiveChart;
