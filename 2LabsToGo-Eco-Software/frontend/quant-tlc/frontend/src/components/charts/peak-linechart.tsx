import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { DataPoint } from "@/utils/peakDetection";
import { hrfTicks, toHrf, type PeakBounds } from "@/utils/quantTlcIntegration";
import type { ChartPeak } from "@/types/peakApi";

interface Props {
  data: DataPoint[];
  lineColor: string;
  channelName: string;
  peaks: ChartPeak[];
  selectedX?: number;
  adding: boolean;
  onToggleAdding: () => void;
  onSelect: (peak: ChartPeak) => void;
  onAdd: (bounds: PeakBounds) => void;
  onResize: (peakX: number, bounds: PeakBounds) => void;
  onDelete: (peakX: number) => void;
}

export default function D3InteractiveChart({
  data, lineColor, channelName, peaks, selectedX, adding, onToggleAdding, onSelect, onAdd, onResize, onDelete,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomTransform = useRef(d3.zoomIdentity);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const element = svgRef.current;
    if (!element || data.length < 2) return;

    const svg = d3.select(element);
    const width = 625;
    const height = 310;
    const lastSample = data.length - 1;
    const x = d3.scaleLinear().domain([0, lastSample]).range([0, width]);
    const [min, max] = d3.extent(data, point => point.y) as [number, number];
    const padding = (max - min || 1) * 0.05;
    const y = d3.scaleLinear().domain([min - padding, max + padding]).nice().range([height, 0]);
    const extent: [[number, number], [number, number]] = [[0, 0], [width, height]];
    const clamp = (index: number) => Math.max(0, Math.min(lastSample, index));
    const interpolate = (index: number) => {
      const left = Math.floor(index);
      return data[left].y + (data[Math.ceil(index)].y - data[left].y) * (index - left);
    };

    function draw(transform: d3.ZoomTransform) {
      svg.selectAll("*").remove();
      const shownX = transform.rescaleX(x);
      const chart = svg.append("g").attr("transform", "translate(55,12)");
      const plot = chart.append("svg").attr("width", width).attr("height", height);

      const hrfScale = shownX.copy().domain(shownX.domain().map(index => toHrf(index, data.length)));
      const axis = d3.axisBottom(hrfScale);
      if (transform.k === 1) axis.tickValues(hrfTicks);
      chart.append("g").attr("transform", `translate(0,${height})`).call(axis);
      chart.append("g").call(d3.axisLeft(y));
      chart.append("text").attr("x", width / 2).attr("y", height + 34)
        .attr("text-anchor", "middle").attr("fill", "currentColor").text("hRF");

      plot.append("path").datum(data)
        .attr("fill", "none").attr("stroke", lineColor).attr("stroke-width", 2)
        .attr("d", d3.line<DataPoint>().x(point => shownX(point.x)).y(point => y(point.y)));

      const brushGroup = plot.append("g");
      const brush = d3.brushX().extent(extent)
        .filter(event => !event.shiftKey && !event.button)
        .on("end", event => {
          if (!event.sourceEvent || !event.selection) return;
          const [x0, x1] = (event.selection as [number, number]).map(pixel => clamp(shownX.invert(pixel)));
          brushGroup.call(brush.move, null);
          if (Math.ceil(x0) <= Math.floor(x1)) onAdd({ x0, x1 });
        });
      if (adding) brushGroup.call(brush);

      for (const peak of peaks) {
        const { startX: x0, endX: x1, x: peakX, y: peakHeight } = peak;
        const color = peakX === selectedX ? "#c2410c" : "#ca8a04";
        const curve = [
          { x: x0, y: interpolate(x0) },
          ...data.slice(Math.ceil(x0), Math.floor(x1) + 1),
          { x: x1, y: interpolate(x1) },
        ];

        const select = () => onSelect(peak);
        plot.append("path").datum(curve).attr("fill", color).attr("opacity", 0.28)
          .attr("cursor", "pointer")
          .attr("d", d3.area<DataPoint>().x(sample => shownX(sample.x)).y0(height).y1(sample => y(sample.y)))
          .on("click", select);
        plot.append("line").attr("x1", shownX(peakX)).attr("x2", shownX(peakX))
          .attr("y1", y(peakHeight)).attr("y2", height).attr("stroke", color)
          .attr("stroke-dasharray", "6,4").attr("pointer-events", "none");
        plot.append("circle").attr("cx", shownX(peakX)).attr("cy", y(peakHeight))
          .attr("r", 5).attr("fill", color).attr("cursor", "pointer")
          .attr("role", "button").attr("tabindex", 0)
          .attr("aria-label", `${peak.source} peak at hRF ${toHrf(peakX, data.length).toFixed(1)}`)
          .on("click", select)
          .on("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              select();
            }
          });

        if (editing && !adding && peakX === selectedX) {
          for (const edge of ["x0", "x1"] as const) {
            const bound = edge === "x0" ? x0 : x1;
            const handle = plot.append("circle").attr("r", 6).attr("fill", color)
              .attr("cursor", "ew-resize").attr("cx", shownX(bound)).attr("cy", y(interpolate(bound)));
            handle.call(d3.drag<SVGCircleElement, unknown>()
              .on("drag", event => {
                const index = clamp(shownX.invert(event.x));
                handle.attr("cx", shownX(index)).attr("cy", y(interpolate(index)));
              })
              .on("end", event => {
                const index = clamp(shownX.invert(event.x));
                const bounds = { x0, x1, [edge]: index };
                if (bounds.x0 < bounds.x1 && Math.ceil(bounds.x0) <= Math.floor(bounds.x1)) {
                  onResize(peakX, bounds);
                } else {
                  draw(transform);
                }
              }));
          }
        }
      }
    }

    const zoom = d3.zoom<SVGSVGElement, unknown>().extent(extent).translateExtent(extent)
      .scaleExtent([1, 10]).filter(event => event.type === "wheel" || (event.shiftKey && !event.button))
      .on("zoom", event => {
        zoomTransform.current = event.transform;
        draw(event.transform);
      });
    svg.call(zoom);
    draw(zoomTransform.current);
    return () => { svg.on(".zoom", null); };
  }, [adding, data, editing, lineColor, onAdd, onResize, onSelect, peaks, selectedX]);

  const selected = peaks.find(peak => peak.x === selectedX);

  return (
    <div className="min-w-0">
      <h3 className="font-semibold capitalize">{channelName}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" disabled={adding} onClick={() => setEditing(!editing)}>
          {editing ? "Finish Editing" : "Edit Peaks"}
        </button>
        <button type="button" className="btn btn-sm" disabled={editing} onClick={onToggleAdding}>
          {adding ? "Finish Adding" : "Add Peaks"}
        </button>
        <button type="button" className="btn btn-sm" disabled={!selected || adding}
          onClick={() => selected && onDelete(selected.x)}>
          Delete Selected Peak
        </button>
      </div>
      <svg ref={svgRef} viewBox="0 0 690 360" className="w-full"
        aria-label={`${channelName} integration chromatogram`} />
      {selected && <p>Selected peak: hRF {toHrf(selected.x, data.length).toFixed(1)}</p>}
    </div>
  );
}
