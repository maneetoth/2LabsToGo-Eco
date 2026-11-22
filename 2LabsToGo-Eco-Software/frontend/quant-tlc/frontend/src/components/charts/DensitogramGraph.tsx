import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useSelector } from "react-redux";
import { RootState } from "@/lib/store";
import {

  PreprocessedOutput,
} from "@/utils/preprocessing";
import { useEffect } from "react";
import { hrfTicks, toHrf } from "@/utils/quantTlcIntegration";

type BandData = {
  red: number[];
  green: number[];
  blue: number[];
  grayscale: number[];
};

const formatDensitogramData = (bandData: BandData, useHrfScale: boolean) => {
  const length = bandData?.red?.length || 0;

  return Array.from({ length }).map((_, index) => ({
    hRF: useHrfScale ? toHrf(index, length) : index,
    red: bandData.red[index],
    green: bandData.green[index],
    blue: bandData.blue[index],
    grayscale: bandData.grayscale[index],
  }));
};


interface DensitogramGraphProps {
  bandStep: number | string;
  preprocessing: string[];
  onProcessedData?: (data: any) => void;
  useHrfScale?: boolean;
  densitogram: PreprocessedOutput
}

const DensitogramGraph = ({
  bandStep,
  useHrfScale = false,
  onProcessedData,
  densitogram
}: DensitogramGraphProps) => {
  const { loading, error } = useSelector((state: RootState) => state.data);
  const bandData = densitogram?.[bandStep];

  useEffect(() => {
    if (onProcessedData && bandData) {
      onProcessedData({
        red: bandData.red.map((y, x) => ({ x, y })),
        green: bandData.green.map((y, x) => ({ x, y })),
        blue: bandData.blue.map((y, x) => ({ x, y })),
        grayscale: bandData.grayscale.map((y, x) => ({ x, y })),
      });
    }
  }, [onProcessedData, bandData]);
  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error}</p>;
  if (!bandData) return <p>No data for track {bandStep}</p>;

  const formattedDensitogram = formatDensitogramData(bandData, useHrfScale);

  return (
    formattedDensitogram.length > 0 && (
      <div className="mt-6 w-full max-w-2xl">
        <h2 className="text-xl font-semibold text-center">Densitogram</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formattedDensitogram}>
            <XAxis
              dataKey="hRF"
              type={useHrfScale ? "number" : "category"}
              domain={useHrfScale ? [0, 100] : undefined}
              ticks={useHrfScale ? hrfTicks : undefined}
              label={{ value: useHrfScale ? "hRF" : "Pixel Index (hRF)", position: "insideBottom", offset: -5 }}
            />
            <YAxis label={{ value: "Pixel Intensity (AU)", angle: -90, position: "insideLeft" }} />
            <Tooltip labelFormatter={useHrfScale ? value => `hRF ${Number(value).toFixed(1)}` : undefined} />
            <Legend />
            <Line type="monotone" dataKey="red" stroke="red" strokeWidth={2} name="Red" dot={false}  />
            <Line type="monotone" dataKey="green" stroke="green" strokeWidth={2} name="Green" dot={false} />
            <Line type="monotone" dataKey="blue" stroke="blue" strokeWidth={2} name="Blue" dot={false} />
            <Line type="monotone" dataKey="grayscale" stroke="gray" strokeWidth={2} name="Grayscale"dot={false}  />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  );
};

export default DensitogramGraph;
