"use client";

import {
  LineChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Label,
} from "recharts";
import * as math from "mathjs";

const mockData = [
  { quantity: 0, intensity: 1 },
  { quantity: 5, intensity: 7 },
  { quantity: 10, intensity: 20 },
  { quantity: 15, intensity: 45 },
  { quantity: 20, intensity: 80 },
];

export default function CalibrationCurve({
  data,
}: {
  data?: { quantity: number; intensity: number }[];
}) {
  const chartData = data || mockData;
  const coeffs = fitPolynomial(chartData, 2);
  const polyLine = generatePolynomialLine(coeffs, 0, 20);
  const equation = getPolynomialEquationString(coeffs);

  return (
  <div className="w-full max-w-3xl mx-auto">
    <h2 className="text-xl font-semibold text-center mb-6">
      Calibration Curve
    </h2>

    <ResponsiveContainer width="100%" height={350}>
      <LineChart>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="quantity" type="number">
          <Label value="Quantity" position="insideBottom" offset={-5} />
        </XAxis>
        <YAxis>
          <Label
            value="Intensity (AU)"
            angle={-90}
            position="insideLeft"
            offset={10}
          />
        </YAxis>
        <Tooltip />
        <Scatter
          name="Standards"
          data={chartData.map((d) => ({ x: d.quantity, y: d.intensity }))}
          fill="#8884d8"
          shape="cross"
        />
        <Line
          data={polyLine}
          dataKey="intensity"
          stroke="#000000"
          dot={false}
          name="Polynomial Fit"
        />
      </LineChart>
    </ResponsiveContainer>

    <div className="mt-6 flex justify-center">
      <div className="alert alert-info shadow-sm text-sm w-fit">
        <span>
          <strong className="font-semibold">Equation:</strong>{" "}
          <code className="text-gray-800">y = {equation}</code>
        </span>
      </div>
    </div>
  </div>
);

}

function fitPolynomial(
  data: { quantity: number; intensity: number }[],
  degree = 2
): number[] {
  const n = data.length;
  const X: number[][] = [];
  const Y: number[][] = [];

  for (let i = 0; i < n; i++) {
    const x = data[i].quantity;
    const y = data[i].intensity;
    const row: number[] = [];
    for (let j = 0; j <= degree; j++) {
      row.push(Math.pow(x, j));
    }
    X.push(row);
    Y.push([y]);
  }

  const XT = math.transpose(X) as number[][];
  const XTX = math.multiply(XT, X) as number[][];
  const XTY = math.multiply(XT, Y) as number[][];
  const coeffsMatrix = math.lusolve(XTX, XTY) as number[][];

  // Flatten to 1D array of coefficients
  const coeffs = coeffsMatrix.map((r) => r[0]);

  return coeffs;
}

function generatePolynomialLine(
  coeffs: number[],
  minX: number,
  maxX: number,
  steps = 100
) {
  const step = (maxX - minX) / steps;
  const fitted = [];

  for (let i = 0; i <= steps; i++) {
    const x = minX + i * step;
    let y = 0;
    for (let j = 0; j < coeffs.length; j++) {
      y += coeffs[j] * Math.pow(x, j);
    }
    fitted.push({ quantity: x, intensity: y });
  }

  return fitted;
}

function getPolynomialEquationString(coeffs: number[]): string {
  return coeffs
    .map((coef, index) => {
      const rounded = Number(coef.toFixed(3));
      if (Math.abs(rounded) < 1e-6) return null; // skip near-zero terms

      const sign = rounded >= 0 ? "+" : "−";
      const absValue = Math.abs(rounded);

      if (index === 0) return `${sign} ${absValue}`;
      if (index === 1) return `${sign} ${absValue}x`;
      return `${sign} ${absValue}x${getSuperscript(index)}`;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/^\+ /, "") // remove leading plus
    .trim();
}

function getSuperscript(num: number): string {
  const superscripts: { [key: string]: string } = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
  };

  return String(num)
    .split("")
    .map((digit) => superscripts[digit])
    .join("");
}

