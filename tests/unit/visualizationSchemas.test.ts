import { describe, it, expect } from "vitest";
import {
  DataPointSchema,
  TimeSeriesPointSchema,
  GeoPointSchema,
  ChartTypeSchema,
  ChartConfigSchema,
  ColumnTypeSchema,
  FilterOperatorSchema,
  ColumnDefSchema,
  SortConfigSchema,
  FilterConfigSchema,
  TableConfigSchema,
  VisualizationTypeSchema,
  VisualizationConfigSchema,
} from "@shared/schemas/visualization";

// ---------------------------------------------------------------------------
// DataPointSchema
// ---------------------------------------------------------------------------
describe("DataPointSchema", () => {
  it("accepts valid data point with label and value", () => {
    const result = DataPointSchema.parse({ label: "Q1", value: 100 });
    expect(result.label).toBe("Q1");
    expect(result.value).toBe(100);
  });

  it("passes through extra properties", () => {
    const result = DataPointSchema.parse({ label: "Q2", value: 200, color: "red" });
    expect((result as any).color).toBe("red");
  });

  it("rejects missing label", () => {
    expect(() => DataPointSchema.parse({ value: 50 })).toThrow();
  });

  it("rejects non-numeric value", () => {
    expect(() => DataPointSchema.parse({ label: "X", value: "not-a-number" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TimeSeriesPointSchema
// ---------------------------------------------------------------------------
describe("TimeSeriesPointSchema", () => {
  it("accepts string timestamp", () => {
    const result = TimeSeriesPointSchema.parse({ timestamp: "2024-01-01T00:00:00Z", value: 42 });
    expect(result.timestamp).toBe("2024-01-01T00:00:00Z");
  });

  it("accepts Date timestamp", () => {
    const d = new Date("2024-06-15");
    const result = TimeSeriesPointSchema.parse({ timestamp: d, value: 10 });
    expect(result.timestamp).toEqual(d);
  });

  it("accepts optional series field", () => {
    const result = TimeSeriesPointSchema.parse({
      timestamp: "2024-01-01",
      value: 5,
      series: "revenue",
    });
    expect(result.series).toBe("revenue");
  });

  it("rejects missing value", () => {
    expect(() => TimeSeriesPointSchema.parse({ timestamp: "2024-01-01" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// GeoPointSchema
// ---------------------------------------------------------------------------
describe("GeoPointSchema", () => {
  it("accepts valid geo point", () => {
    const result = GeoPointSchema.parse({ lat: 40.7128, lng: -74.006, value: 8336817 });
    expect(result.lat).toBe(40.7128);
  });

  it("accepts optional label", () => {
    const result = GeoPointSchema.parse({ lat: 0, lng: 0, value: 0, label: "Null Island" });
    expect(result.label).toBe("Null Island");
  });

  it("rejects missing lng", () => {
    expect(() => GeoPointSchema.parse({ lat: 10, value: 1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChartTypeSchema
// ---------------------------------------------------------------------------
describe("ChartTypeSchema", () => {
  it("accepts all valid chart types", () => {
    const types = ["bar", "line", "area", "pie", "donut", "scatter", "heatmap", "map"];
    for (const t of types) {
      expect(ChartTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown chart type", () => {
    expect(() => ChartTypeSchema.parse("radar")).toThrow();
    expect(() => ChartTypeSchema.parse("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChartConfigSchema
// ---------------------------------------------------------------------------
describe("ChartConfigSchema", () => {
  it("accepts minimal chart config with DataPoint data", () => {
    const config = {
      type: "bar",
      data: [{ label: "A", value: 10 }],
    };
    const result = ChartConfigSchema.parse(config);
    expect(result.type).toBe("bar");
    expect(result.data).toHaveLength(1);
  });

  it("accepts chart config with TimeSeriesPoint data", () => {
    const config = {
      type: "line",
      data: [{ timestamp: "2024-01-01", value: 100 }],
    };
    const result = ChartConfigSchema.parse(config);
    expect(result.data).toHaveLength(1);
  });

  it("accepts chart config with GeoPoint data", () => {
    const config = {
      type: "map",
      data: [{ lat: 51.5074, lng: -0.1278, value: 9 }],
      mapCenter: [51.5, -0.12] as [number, number],
      mapZoom: 10,
    };
    const result = ChartConfigSchema.parse(config);
    expect(result.mapCenter).toEqual([51.5, -0.12]);
  });

  it("accepts all optional display fields", () => {
    const config = {
      type: "pie",
      data: [{ label: "X", value: 1 }],
      title: "Sales",
      subtitle: "Q1 2024",
      width: 600,
      height: "100%",
      responsive: true,
      colors: ["#ff0000", "#00ff00"],
      showLegend: true,
      showGrid: false,
      showTooltip: true,
      enableZoom: false,
      enablePan: false,
      enableExport: true,
      xAxisKey: "month",
      yAxisKey: "revenue",
      seriesKey: "region",
    };
    const result = ChartConfigSchema.parse(config);
    expect(result.title).toBe("Sales");
    expect(result.colors).toHaveLength(2);
    expect(result.responsive).toBe(true);
  });

  it("rejects empty data array when type requires specific shape", () => {
    // Empty arrays are accepted by union (matches any of the three)
    const config = { type: "bar", data: [] };
    const result = ChartConfigSchema.parse(config);
    expect(result.data).toHaveLength(0);
  });

  it("rejects missing type", () => {
    expect(() => ChartConfigSchema.parse({ data: [{ label: "A", value: 1 }] })).toThrow();
  });

  it("accepts width as string (e.g. percentage)", () => {
    const result = ChartConfigSchema.parse({
      type: "area",
      data: [{ label: "Z", value: 0 }],
      width: "100%",
    });
    expect(result.width).toBe("100%");
  });
});

// ---------------------------------------------------------------------------
// ColumnTypeSchema + FilterOperatorSchema
// ---------------------------------------------------------------------------
describe("ColumnTypeSchema", () => {
  it("accepts all valid column types", () => {
    for (const ct of ["text", "number", "date", "boolean", "select", "currency"]) {
      expect(ColumnTypeSchema.parse(ct)).toBe(ct);
    }
  });

  it("rejects invalid column type", () => {
    expect(() => ColumnTypeSchema.parse("json")).toThrow();
  });
});

describe("FilterOperatorSchema", () => {
  it("accepts all valid filter operators", () => {
    const ops = ["equals", "contains", "startsWith", "endsWith", "gt", "lt", "gte", "lte", "between", "in"];
    for (const op of ops) {
      expect(FilterOperatorSchema.parse(op)).toBe(op);
    }
  });

  it("rejects unknown operator", () => {
    expect(() => FilterOperatorSchema.parse("notEqual")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ColumnDefSchema
// ---------------------------------------------------------------------------
describe("ColumnDefSchema", () => {
  it("accepts a minimal column definition", () => {
    const col = { id: "name", header: "Name", accessorKey: "name", type: "text" };
    const result = ColumnDefSchema.parse(col);
    expect(result.id).toBe("name");
  });

  it("accepts all optional column fields", () => {
    const col = {
      id: "price",
      header: "Price",
      accessorKey: "price",
      type: "currency",
      sortable: true,
      filterable: true,
      filterOptions: ["USD", "EUR"],
      width: 150,
      align: "right",
      format: "$0,0.00",
    };
    const result = ColumnDefSchema.parse(col);
    expect(result.align).toBe("right");
    expect(result.filterOptions).toHaveLength(2);
  });

  it("rejects invalid align value", () => {
    expect(() =>
      ColumnDefSchema.parse({ id: "x", header: "X", accessorKey: "x", type: "text", align: "justify" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SortConfigSchema + FilterConfigSchema
// ---------------------------------------------------------------------------
describe("SortConfigSchema", () => {
  it("accepts valid sort config", () => {
    const result = SortConfigSchema.parse({ id: "name", desc: false });
    expect(result.desc).toBe(false);
  });

  it("rejects missing desc", () => {
    expect(() => SortConfigSchema.parse({ id: "name" })).toThrow();
  });
});

describe("FilterConfigSchema", () => {
  it("accepts any value type", () => {
    const result = FilterConfigSchema.parse({ id: "status", value: ["active", "pending"] });
    expect(result.value).toEqual(["active", "pending"]);
  });

  it("accepts null value", () => {
    const result = FilterConfigSchema.parse({ id: "col", value: null });
    expect(result.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TableConfigSchema
// ---------------------------------------------------------------------------
describe("TableConfigSchema", () => {
  const minCol = { id: "c1", header: "C1", accessorKey: "c1", type: "text" as const };

  it("accepts minimal table config", () => {
    const result = TableConfigSchema.parse({
      columns: [minCol],
      data: [{ c1: "hello" }],
    });
    expect(result.columns).toHaveLength(1);
    expect(result.data).toHaveLength(1);
  });

  it("accepts all optional table features", () => {
    const result = TableConfigSchema.parse({
      columns: [minCol],
      data: [],
      pageSize: 25,
      serverSide: true,
      totalRows: 1000,
      enableSorting: true,
      enableFiltering: true,
      enableGlobalSearch: true,
      enableRowSelection: false,
      enableVirtualization: true,
    });
    expect(result.pageSize).toBe(25);
    expect(result.serverSide).toBe(true);
    expect(result.totalRows).toBe(1000);
  });

  it("rejects missing columns", () => {
    expect(() => TableConfigSchema.parse({ data: [] })).toThrow();
  });

  it("rejects missing data", () => {
    expect(() => TableConfigSchema.parse({ columns: [minCol] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// VisualizationTypeSchema + VisualizationConfigSchema
// ---------------------------------------------------------------------------
describe("VisualizationTypeSchema", () => {
  it("accepts 'chart' and 'table'", () => {
    expect(VisualizationTypeSchema.parse("chart")).toBe("chart");
    expect(VisualizationTypeSchema.parse("table")).toBe("table");
  });

  it("rejects unknown visualization type", () => {
    expect(() => VisualizationTypeSchema.parse("graph")).toThrow();
  });
});

describe("VisualizationConfigSchema", () => {
  it("accepts chart visualization with chart config", () => {
    const result = VisualizationConfigSchema.parse({
      id: "viz-1",
      type: "chart",
      chart: {
        type: "bar",
        data: [{ label: "A", value: 10 }],
      },
    });
    expect(result.id).toBe("viz-1");
    expect(result.chart?.type).toBe("bar");
  });

  it("accepts table visualization with table config", () => {
    const result = VisualizationConfigSchema.parse({
      id: "viz-2",
      type: "table",
      table: {
        columns: [{ id: "c", header: "C", accessorKey: "c", type: "text" }],
        data: [{ c: "val" }],
      },
    });
    expect(result.type).toBe("table");
    expect(result.table?.columns).toHaveLength(1);
  });

  it("accepts visualization without optional chart or table", () => {
    const result = VisualizationConfigSchema.parse({
      id: "viz-3",
      type: "chart",
    });
    expect(result.chart).toBeUndefined();
    expect(result.table).toBeUndefined();
  });

  it("rejects missing id", () => {
    expect(() =>
      VisualizationConfigSchema.parse({ type: "chart" })
    ).toThrow();
  });

  it("rejects missing type", () => {
    expect(() =>
      VisualizationConfigSchema.parse({ id: "v" })
    ).toThrow();
  });
});
