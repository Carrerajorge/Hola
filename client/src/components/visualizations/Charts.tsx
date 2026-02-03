import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import ReactECharts from 'echarts-for-react';

interface ChartDatum {
    label: string;
    value: number;
}

interface ChartsProps {
    data?: ChartDatum[];
    type?: 'bar' | 'line' | 'pie';
    title?: string;
}

const fallbackData: ChartDatum[] = [
    { label: 'Ene', value: 120 },
    { label: 'Feb', value: 200 },
    { label: 'Mar', value: 150 },
    { label: 'Abr', value: 80 },
    { label: 'May', value: 70 },
    { label: 'Jun', value: 110 },
];

export default function Charts({ data, type = 'bar', title = 'Chart' }: ChartsProps) {
    const chartData = data?.length ? data : fallbackData;
    const option = useMemo(() => {
        if (type === 'pie') {
            return {
                tooltip: { trigger: 'item' },
                series: [
                    {
                        type: 'pie',
                        radius: ['30%', '70%'],
                        data: chartData.map((item) => ({ name: item.label, value: item.value }))
                    }
                ]
            };
        }

        return {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: chartData.map((item) => item.label)
            },
            yAxis: { type: 'value' },
            series: [
                {
                    type,
                    data: chartData.map((item) => item.value),
                    smooth: type === 'line'
                }
            ]
        };
    }, [chartData, type]);

    return (
        <div className="w-full h-80 border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
                <BarChart3 className="w-4 h-4" />
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground capitalize">({type})</span>
            </div>
            <div className="h-[17rem] p-2">
                <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
            </div>
        </div>
    );
}
