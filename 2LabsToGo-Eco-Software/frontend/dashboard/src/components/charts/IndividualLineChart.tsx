import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Brush } from "recharts";

interface ChartProps {
    color: string;
    title: string;
    dataKey: string;
}

const IndividualLineChart: React.FC<ChartProps> = ({ color, title, dataKey }) => {
    // Mock Data for the densitogram
    const densitogramData = [
        { hRF: 10, raw: 30, baseline: 28, inverse: 35, smooth: 32 },
        { hRF: 20, raw: 50, baseline: 48, inverse: 55, smooth: 52 },
        { hRF: 30, raw: 80, baseline: 78, inverse: 85, smooth: 82 },
        { hRF: 40, raw: 60, baseline: 58, inverse: 65, smooth: 62 },
        { hRF: 50, raw: 90, baseline: 88, inverse: 95, smooth: 92 }
    ];

    return (
        <div className="p-4 border rounded-lg shadow-md">
            <h3 className={`text-center font-semibold text-${color}-500`}>{title}</h3>
            <ResponsiveContainer width="100%" height={400}>
                <LineChart data={densitogramData}>
                    <XAxis dataKey="hRF" label={{ value: "hRF", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "Pixel Intensity (AU)", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} name={title} />
                    <Brush dataKey="hRF" height={30} stroke="#8884d8" />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default IndividualLineChart;
