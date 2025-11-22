// utils/cropImage.ts
export default function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageSrc;

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return reject("Canvas context not available");

      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
      );

      canvas.toBlob((blob) => {
        if (!blob) return reject("Canvas is empty");
        const url = URL.createObjectURL(blob);
        resolve(url);
      }, "image/jpeg");
    };

    image.onerror = (error) => reject(error);
  });
}

// helpers.ts
export function base64ToDataUrl(b64: string, mime = "image/png"): string {
  // If it already includes the data URL header, just return it
  if (b64.startsWith("data:")) return b64;
  return `data:${mime};base64,${b64}`;
}