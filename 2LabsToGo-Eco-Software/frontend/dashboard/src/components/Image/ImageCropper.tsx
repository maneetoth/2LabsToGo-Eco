"use client";

import React, { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import getCroppedImg from "@/utils/cropImage";

interface Props {
  imageUrl: string;
}

interface CroppedArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ImageCropper: React.FC<Props> = ({ imageUrl }) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CroppedArea | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);

  const onCropComplete = useCallback(
    (_: any, croppedArea: CroppedArea) => {
      setCroppedAreaPixels(croppedArea);
    },
    []
  );

  const showCroppedImage = useCallback(async () => {
    if (!croppedAreaPixels) return;
    try {
      const croppedImg = await getCroppedImg(imageUrl, croppedAreaPixels);
      setCroppedImage(croppedImg);
    } catch (error) {
      console.error("Crop failed:", error);
    }
  }, [imageUrl, croppedAreaPixels]);

  return (
    <div className="mt-4">
      {!croppedImage ? (
        <div className="relative w-full h-[400px] bg-gray-200">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={4 / 3}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
          <div className="mt-4 flex gap-4">
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-1/2"
            />
            <button
              onClick={showCroppedImage}
              className="p-2 bg-blue-500 text-white rounded"
            >
              Crop Image
            </button>
          </div>
        </div>
      ) : (
        <img
          src={croppedImage}
          alt="Cropped"
          className="w-full max-w-lg rounded-lg shadow-lg"
        />
      )}
    </div>
  );
};

export default ImageCropper;
