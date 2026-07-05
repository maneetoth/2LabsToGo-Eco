"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useRef } from "react";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

export interface NodeObj {
  id: string | number;
  fx?: number;
  fy?: number;
  fz?: number;
  color?: string;
  src?: string;
  label?: string;
  x?: number;
  y?: number;
  z?: number;
}

interface Graph3DProps {
  graphData: {
    nodes: NodeObj[];
    links: any[];
  };
  onNodeHover: (node: NodeObj | null, prevNode: NodeObj | null) => void;
}

export default function Graph3D({ graphData, onNodeHover }: Graph3DProps) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: 600,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  return (
    <div ref={containerRef} className="w-full h-[600px] border border-gray-200 rounded-lg overflow-hidden bg-[#000010] relative">
      {dimensions.width > 0 && (
        <ForceGraph3D
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          nodeRelSize={4}
          enableNodeDrag={false}
          enableNavigationControls={true}
          nodeColor={(node: any) => node.color || "cyan"}
          onNodeHover={(node: any, prevNode: any) => onNodeHover(node, prevNode)}
        />
      )}
    </div>
  );
}
