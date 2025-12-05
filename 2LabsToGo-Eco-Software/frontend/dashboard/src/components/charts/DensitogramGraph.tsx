import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useSelector } from "react-redux";
import { RootState } from "@/lib/store";
import {

  PreprocessedOutput,
} from "@/utils/preprocessing";
import { useEffect, useMemo } from "react";

type BandData = {
  red: number[];
  green: number[];
  blue: number[];
  grayscale: number[];
};

const formatDensitogramData = (bandData: BandData) => {
  const length = bandData?.red?.length || 0;

  return Array.from({ length }).map((_, index) => ({
    hRF: index,
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
  densitogram: PreprocessedOutput
}

const DensitogramGraph = ({
  bandStep,
  preprocessing,
  onProcessedData,
  densitogram
}: DensitogramGraphProps) => {
  const { data, loading, error } = useSelector((state: RootState) => state.data);


 
  const bandData = densitogram ? densitogram?.[bandStep] : undefined;
  console.log('in desitigram');

  
  
  
  
  const densitogramData = useMemo(() => {
    if (!bandData) return [];
    
    return formatDensitogramData({
      red: bandData.red,
      green:bandData.green,
      blue: bandData.blue,
      grayscale:bandData.grayscale,
    });
    
  }, [bandData]);
  
  
  
  // ...existing code...
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
  // ...existing code...
  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error}</p>;
  // if (!data?.densitogram_data) return <p>No densitogram data available</p>;
  if (!bandData) return <p>No data for band {bandStep}</p>;
  
  const formatedDensitogram = formatDensitogramData({
    red: bandData.red,
    green: bandData.green,
    blue: bandData.blue,
    grayscale: bandData.grayscale,
  });
  
  console.log(bandData);
  console.log('after sinsitogram');
  console.log(formatedDensitogram);
  
  
  
 

  return (
    formatedDensitogram.length > 0 && (
      <div className="mt-6 w-full max-w-2xl">
        <h2 className="text-xl font-semibold text-center">Densitogram</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formatedDensitogram}>
            <XAxis dataKey="hRF" label={{ value: "hRF", position: "insideBottom", offset: -5 }} />
            <YAxis label={{ value: "Pixel Intensity (AU)", angle: -90, position: "insideLeft" }} />
            <Tooltip />
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