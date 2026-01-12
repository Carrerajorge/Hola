import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  AlertCircle,
  Lightbulb,
  Target,
  FileText,
  Info,
  ExternalLink,
  Table as TableIcon,
  BarChart3,
  MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import type {
  DocumentSemanticModel,
  Insight,
  Metric,
  Anomaly,
  Table,
  SheetSummary,
  SuggestedQuestion,
} from '../../../shared/schemas/documentSemanticModel';

export interface DocumentAnalysisResultsProps {
  documentModel: DocumentSemanticModel;
  insights: Insight[];
  suggestedQuestions: SuggestedQuestion[];
  onQuestionClick: (question: string) => void;
}

const InsightTypeIcon = ({ type }: { type: Insight['type'] }) => {
  switch (type) {
    case 'finding':
      return <Lightbulb className="h-4 w-4 text-blue-500" />;
    case 'risk':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case 'opportunity':
      return <Target className="h-4 w-4 text-green-500" />;
    case 'recommendation':
      return <FileText className="h-4 w-4 text-purple-500" />;
    case 'summary':
      return <Info className="h-4 w-4 text-gray-500" />;
    default:
      return <Info className="h-4 w-4 text-muted-foreground" />;
  }
};

const TrendIcon = ({ trend }: { trend?: 'up' | 'down' | 'stable' }) => {
  switch (trend) {
    case 'up':
      return <TrendingUp className="h-4 w-4 text-green-500" />;
    case 'down':
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    case 'stable':
      return <Minus className="h-4 w-4 text-muted-foreground" />;
    default:
      return null;
  }
};

const SeverityBadge = ({ severity }: { severity: 'low' | 'medium' | 'high' }) => {
  const variants: Record<string, 'default' | 'warning' | 'destructive'> = {
    low: 'default',
    medium: 'warning',
    high: 'destructive',
  };
  return (
    <Badge variant={variants[severity]} data-testid={`severity-badge-${severity}`}>
      {severity}
    </Badge>
  );
};

const ConfidenceBadge = ({ confidence }: { confidence: 'low' | 'medium' | 'high' }) => {
  const colors: Record<string, string> = {
    low: 'bg-gray-100 text-gray-700 border-gray-200',
    medium: 'bg-blue-50 text-blue-700 border-blue-200',
    high: 'bg-green-50 text-green-700 border-green-200',
  };
  return (
    <span
      className={cn('px-2 py-0.5 text-xs rounded-full border', colors[confidence])}
      data-testid={`confidence-badge-${confidence}`}
    >
      {confidence} confidence
    </span>
  );
};

const CitationBadge = ({
  sourceRef,
  onClick,
}: {
  sourceRef: string;
  onClick?: () => void;
}) => (
  <Badge
    variant="outline"
    className="cursor-pointer hover:bg-accent text-xs"
    onClick={onClick}
    data-testid={`citation-badge-${sourceRef}`}
  >
    <ExternalLink className="h-3 w-3 mr-1" />
    {sourceRef}
  </Badge>
);

function InsightsSection({ insights }: { insights: Insight[] }) {
  if (!insights || insights.length === 0) return null;

  return (
    <div data-testid="insights-section">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        Insights
      </h3>
      <ScrollArea className="w-full whitespace-nowrap pb-4">
        <div className="flex gap-3">
          {insights.map((insight) => (
            <Card
              key={insight.id}
              className="min-w-[280px] max-w-[320px] flex-shrink-0"
              data-testid={`insight-card-${insight.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <InsightTypeIcon type={insight.type} />
                    <Badge variant="outline" className="text-xs capitalize">
                      {insight.type}
                    </Badge>
                  </div>
                  <ConfidenceBadge confidence={insight.confidence} />
                </div>
                <CardTitle className="text-sm mt-2 whitespace-normal">{insight.title}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground whitespace-normal line-clamp-3 mb-3">
                  {insight.description}
                </p>
                {insight.sourceRefs && insight.sourceRefs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {insight.sourceRefs.map((ref) => (
                      <CitationBadge key={ref} sourceRef={ref} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

function SheetTabs({
  sheets,
  tables,
  activeSheet,
  onSheetChange,
}: {
  sheets?: SheetSummary[];
  tables: Table[];
  activeSheet: string;
  onSheetChange: (sheet: string) => void;
}) {
  if (!sheets || sheets.length === 0) return null;

  return (
    <div data-testid="sheet-tabs-section">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <TableIcon className="h-5 w-5 text-primary" />
        Sheet Data
      </h3>
      <Tabs value={activeSheet} onValueChange={onSheetChange}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
          {sheets.map((sheet) => (
            <TabsTrigger
              key={sheet.name}
              value={sheet.name}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-3 py-1.5 text-sm"
              data-testid={`sheet-tab-${sheet.name}`}
            >
              <span className="flex items-center gap-1.5">
                {sheet.name}
                <span className="text-xs opacity-70">
                  ({sheet.rowCount}×{sheet.columnCount})
                </span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {sheets.map((sheet) => (
          <TabsContent key={sheet.name} value={sheet.name} className="mt-4">
            <SheetContent sheet={sheet} tables={tables.filter((t) => t.sheetName === sheet.name)} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function SheetContent({ sheet, tables }: { sheet: SheetSummary; tables: Table[] }) {
  return (
    <div className="space-y-4" data-testid={`sheet-content-${sheet.name}`}>
      {sheet.summary && (
        <p className="text-sm text-muted-foreground">{sheet.summary}</p>
      )}
      {tables.map((table) => (
        <TablePreview key={table.id} table={table} />
      ))}
    </div>
  );
}

function MetricsGrid({
  metrics,
  onMetricClick,
}: {
  metrics: Metric[];
  onMetricClick?: (sourceRef: string) => void;
}) {
  if (!metrics || metrics.length === 0) return null;

  return (
    <div data-testid="metrics-grid-section">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        Key Metrics
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {metrics.map((metric) => (
          <Card
            key={metric.id}
            className={cn(
              'cursor-pointer hover:shadow-md transition-shadow',
              onMetricClick && 'hover:border-primary'
            )}
            onClick={() => onMetricClick?.(metric.sourceRef)}
            data-testid={`metric-card-${metric.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {metric.name}
                </span>
                <TrendIcon trend={metric.trend} />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{metric.value}</span>
                {metric.unit && (
                  <span className="text-sm text-muted-foreground">{metric.unit}</span>
                )}
              </div>
              {metric.change !== undefined && (
                <span
                  className={cn(
                    'text-xs',
                    metric.change > 0 && 'text-green-600',
                    metric.change < 0 && 'text-red-600',
                    metric.change === 0 && 'text-muted-foreground'
                  )}
                >
                  {metric.change > 0 ? '+' : ''}
                  {metric.change}%
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TablePreview({ table }: { table: Table }) {
  const [showMore, setShowMore] = useState(false);
  const PREVIEW_ROWS = 20;

  const displayRows = useMemo(() => {
    const rows = table.previewRows || table.rows;
    return showMore ? rows : rows.slice(0, PREVIEW_ROWS);
  }, [table, showMore]);

  const hasMoreRows = (table.previewRows || table.rows).length > PREVIEW_ROWS;

  const getColumnStats = useCallback(
    (colIndex: number) => {
      const header = table.headers[colIndex];
      const stats = table.stats?.numericStats?.[header];
      const nullCount = table.stats?.nullCount?.[header];
      if (!stats && nullCount === undefined) return null;
      return { ...stats, nullCount };
    },
    [table]
  );

  return (
    <div className="border rounded-lg overflow-hidden" data-testid={`table-preview-${table.id}`}>
      {table.title && (
        <div className="bg-muted/50 px-3 py-2 border-b">
          <span className="text-sm font-medium">{table.title}</span>
        </div>
      )}
      <ScrollArea className="w-full">
        <div className="min-w-max">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                {table.headers.map((header, idx) => {
                  const stats = getColumnStats(idx);
                  return (
                    <TooltipProvider key={idx}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <th
                            className="px-3 py-2 text-left font-medium text-muted-foreground border-b cursor-help"
                            data-testid={`table-header-${table.id}-${idx}`}
                          >
                            <div className="flex items-center gap-1">
                              {header}
                              {stats && <Info className="h-3 w-3 opacity-50" />}
                            </div>
                          </th>
                        </TooltipTrigger>
                        {stats && (
                          <TooltipContent side="top" className="max-w-xs">
                            <div className="text-xs space-y-1">
                              <div className="font-medium">{header} Stats</div>
                              {stats.min !== undefined && <div>Min: {stats.min}</div>}
                              {stats.max !== undefined && <div>Max: {stats.max}</div>}
                              {stats.avg !== undefined && <div>Avg: {stats.avg.toFixed(2)}</div>}
                              {stats.nullCount !== undefined && (
                                <div>Nulls: {stats.nullCount}</div>
                              )}
                            </div>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b last:border-0 hover:bg-muted/20">
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className={cn(
                        'px-3 py-2',
                        cell.type === 'number' && 'text-right tabular-nums',
                        cell.type === 'empty' && 'text-muted-foreground/50'
                      )}
                      data-testid={`table-cell-${table.id}-${rowIdx}-${cellIdx}`}
                    >
                      {cell.value === null || cell.value === undefined
                        ? '—'
                        : String(cell.value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {hasMoreRows && (
        <div className="px-3 py-2 border-t bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMore(!showMore)}
            className="text-xs"
            data-testid={`table-show-more-${table.id}`}
          >
            {showMore
              ? 'Show less'
              : `Show ${(table.previewRows || table.rows).length - PREVIEW_ROWS} more rows`}
          </Button>
        </div>
      )}
    </div>
  );
}

function TablesSection({ tables }: { tables: Table[] }) {
  if (!tables || tables.length === 0) return null;

  const standaloneTables = tables.filter((t) => !t.sheetName);
  if (standaloneTables.length === 0) return null;

  return (
    <div className="space-y-4" data-testid="tables-section">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <TableIcon className="h-5 w-5 text-primary" />
        Tables
      </h3>
      {standaloneTables.map((table) => (
        <TablePreview key={table.id} table={table} />
      ))}
    </div>
  );
}

function AnomaliesSection({ anomalies }: { anomalies: Anomaly[] }) {
  if (!anomalies || anomalies.length === 0) return null;

  const groupedAnomalies = useMemo(() => {
    const groups: Record<string, Anomaly[]> = { high: [], medium: [], low: [] };
    anomalies.forEach((a) => {
      groups[a.severity].push(a);
    });
    return groups;
  }, [anomalies]);

  const severityOrder: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];

  return (
    <div data-testid="anomalies-section">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-500" />
        Anomalies Detected
      </h3>
      <div className="space-y-4">
        {severityOrder.map((severity) => {
          const items = groupedAnomalies[severity];
          if (items.length === 0) return null;

          return (
            <div key={severity} data-testid={`anomalies-group-${severity}`}>
              <div className="flex items-center gap-2 mb-2">
                <SeverityBadge severity={severity} />
                <span className="text-sm text-muted-foreground">
                  {items.length} {items.length === 1 ? 'issue' : 'issues'}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((anomaly) => (
                  <Card
                    key={anomaly.id}
                    className={cn(
                      'border-l-4',
                      severity === 'high' && 'border-l-red-500',
                      severity === 'medium' && 'border-l-amber-500',
                      severity === 'low' && 'border-l-gray-400'
                    )}
                    data-testid={`anomaly-card-${anomaly.id}`}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs capitalize">
                              {anomaly.type}
                            </Badge>
                          </div>
                          <p className="text-sm">{anomaly.description}</p>
                          {anomaly.suggestedAction && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Suggestion: {anomaly.suggestedAction}
                            </p>
                          )}
                        </div>
                        <CitationBadge sourceRef={anomaly.sourceRef} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuggestedQuestionsSection({
  questions,
  onQuestionClick,
}: {
  questions: SuggestedQuestion[];
  onQuestionClick: (question: string) => void;
}) {
  if (!questions || questions.length === 0) return null;

  return (
    <div data-testid="suggested-questions-section">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        Suggested Questions
      </h3>
      <div className="flex flex-wrap gap-2">
        {questions.map((q) => (
          <Button
            key={q.id}
            variant="outline"
            size="sm"
            className="h-auto py-2 px-3 text-sm text-left whitespace-normal max-w-xs hover:bg-primary hover:text-primary-foreground transition-colors"
            onClick={() => onQuestionClick(q.question)}
            data-testid={`suggested-question-${q.id}`}
          >
            {q.question}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function DocumentAnalysisResults({
  documentModel,
  insights,
  suggestedQuestions,
  onQuestionClick,
}: DocumentAnalysisResultsProps) {
  const [activeSheet, setActiveSheet] = useState<string>(
    documentModel.sheets?.[0]?.name || ''
  );

  const handleMetricClick = useCallback((sourceRef: string) => {
    const element = document.querySelector(`[data-source-ref="${sourceRef}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const hasSheets = documentModel.sheets && documentModel.sheets.length > 0;

  return (
    <TooltipProvider>
      <div
        className="space-y-6 w-full max-w-4xl mx-auto"
        data-testid="document-analysis-results"
      >
        <InsightsSection insights={insights} />

        {hasSheets ? (
          <SheetTabs
            sheets={documentModel.sheets}
            tables={documentModel.tables}
            activeSheet={activeSheet}
            onSheetChange={setActiveSheet}
          />
        ) : (
          <TablesSection tables={documentModel.tables} />
        )}

        <MetricsGrid metrics={documentModel.metrics} onMetricClick={handleMetricClick} />

        <AnomaliesSection anomalies={documentModel.anomalies} />

        <SuggestedQuestionsSection
          questions={suggestedQuestions}
          onQuestionClick={onQuestionClick}
        />
      </div>
    </TooltipProvider>
  );
}

export default DocumentAnalysisResults;
