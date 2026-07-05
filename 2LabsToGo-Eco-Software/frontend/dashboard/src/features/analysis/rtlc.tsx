"use client";

import React, { useState, useMemo } from "react";
import Graph3D, { NodeObj } from "@/components/charts/Graph3D";

function randomInRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export default function RTLC() {
  const [images, setImages] = useState<{ file: File; src: string; id: string }[]>([]);
  const [hoveredNode, setHoveredNode] = useState<NodeObj | null>(null);

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

  const graphData = useMemo(() => {
    const nodes: NodeObj[] = images.map((img) => ({
      id: img.id,
      label: img.file.name,
      src: img.src,
      fx: randomInRange(-300, 300),
      fy: randomInRange(-300, 300),
      fz: randomInRange(-300, 300),
      color: "cyan",
    }));

    const links: any[] = [];
    if (nodes.length > 1) {
      nodes.forEach((node, i) => {
        if (i > 0) {
          links.push({ source: node.id, target: nodes[i - 1].id });
        }
        if (nodes.length > 3 && Math.random() > 0.5) {
          const targetIndex = Math.floor(Math.random() * nodes.length);
          if (targetIndex !== i) {
            links.push({ source: node.id, target: nodes[targetIndex].id });
          }
        }
      });
    }

    return { nodes, links };
  }, [images]);

  return (
    <div className="flex flex-col w-full min-h-screen bg-gray-50 p-6 font-sans relative">
      {/* 3D Node Hover Popup */}
      {hoveredNode && hoveredNode.src && (
        <div 
          className="fixed top-24 left-1/2 transform -translate-x-1/2 z-50 bg-white/90 backdrop-blur-md p-4 rounded-xl shadow-2xl border border-gray-200 pointer-events-none transition-opacity duration-200"
        >
          <img
            src={hoveredNode.src}
            alt={hoveredNode.label || "Node image"}
            className="w-48 h-auto object-cover rounded-lg shadow-inner mb-3 border border-gray-300"
          />
          <p className="text-sm font-semibold text-gray-800 text-center break-words max-w-[12rem]">
            {hoveredNode.label}
          </p>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full space-y-6">
        {/* Header section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 tracking-tight">RTLC Analysis</h1>
            <p className="text-gray-500 mt-2">
              Upload multiple images to visualize them in high-dimension 3D space.
            </p>
          </div>
        </div>

        {/* Upload Section */}
        <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100">
          <div className="flex flex-col items-center justify-center w-full">
            <label
              htmlFor="dropzone-file"
              className="flex flex-col items-center justify-center w-full h-40 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg
                  className="w-8 h-8 mb-4 text-gray-400"
                  aria-hidden="true"
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
                <p className="mb-2 text-sm text-gray-500 font-medium">
                  <span className="font-semibold text-blue-600">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-gray-500">PNG, JPG, JPEG (Max multiple images)</p>
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
          </div>
          
          {/* Selected Images Previews */}
          {images.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 border-b pb-2">Uploaded Images ({images.length})</h3>
              <div className="flex overflow-x-auto pb-4 gap-3">
                {images.map((img) => (
                  <div key={img.id} className="relative group flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border border-gray-200 shadow-sm bg-gray-50">
                    <img
                      src={img.src}
                      alt={img.file.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={() => removeImage(img.id)}
                        className="bg-red-500 hover:bg-red-600 text-white p-1 rounded-full transform hover:scale-105 transition-transform"
                        title="Remove image"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3D Visualization Section */}
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 mb-4 px-2">3D Feature Space</h2>
          {images.length === 0 ? (
            <div className="w-full h-[600px] flex items-center justify-center bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-gray-500 text-lg">Upload images to visualize them in 3D space</p>
            </div>
          ) : (
            <Graph3D 
              graphData={graphData} 
              onNodeHover={(node) => setHoveredNode(node)} 
            />
          )}
        </div>

      </div>
    </div>
  );
}
