import { useEffect, useMemo, useState } from 'react';
import { Table } from 'lucide-react';
import { HotTable } from '@handsontable/react';
import 'handsontable/dist/handsontable.full.min.css';

interface ExcelEditorProps {
    data?: any[][];
    onChange?: (data: any[][]) => void;
}

const DEFAULT_ROWS = 20;
const DEFAULT_COLS = 10;

export default function ExcelEditor({ data, onChange }: ExcelEditorProps) {
    const initialData = useMemo(() => {
        if (data && data.length > 0) return data;
        return Array.from({ length: DEFAULT_ROWS }, () =>
            Array.from({ length: DEFAULT_COLS }, () => '')
        );
    }, [data]);

    const [tableData, setTableData] = useState<any[][]>(initialData);

    useEffect(() => {
        setTableData(initialData);
    }, [initialData]);

    return (
        <div className="w-full h-[28rem] border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
                <Table className="w-4 h-4" />
                <span className="text-sm font-medium">Hoja de Cálculo</span>
            </div>
            <div className="h-[24rem] overflow-hidden">
                <HotTable
                    data={tableData}
                    colHeaders
                    rowHeaders
                    stretchH="all"
                    licenseKey="non-commercial-and-evaluation"
                    height="100%"
                    width="100%"
                    afterChange={(changes, source) => {
                        if (!changes || source === 'loadData') return;
                        setTableData((prev) => {
                            const next = prev.map((row) => [...row]);
                            changes.forEach(([row, col, _oldValue, newValue]) => {
                                const colIndex = typeof col === 'number' ? col : Number(col);
                                if (!Number.isNaN(colIndex)) {
                                    next[row][colIndex] = newValue ?? '';
                                }
                            });
                            onChange?.(next);
                            return next;
                        });
                    }}
                    manualColumnResize
                    manualRowResize
                    contextMenu
                />
            </div>
        </div>
    );
}
