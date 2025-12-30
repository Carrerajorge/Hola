import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  ChevronDown, 
  Code, 
  RefreshCw,
  FileSpreadsheet,
  BarChart3,
  Clock,
  XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface SheetAnalysisStatus {
  sheetName: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
}

interface SheetResult {
  sheetName: string;
  generatedCode?: string;
  summary?: string;
  metrics?: Array<{ label: string; value: string }>;
  preview?: { headers: string[]; rows: any[][] };
  error?: string;
}

interface AnalysisResponse {
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  progress?: {
    currentSheet: number;
    totalSheets: number;
    sheets: SheetAnalysisStatus[];
  };
  results?: {
    crossSheetSummary?: string;
    sheets: SheetResult[];
  };
  error?: string;
}

interface DocumentAnalysisResultsProps {
  uploadId: string;
  filename: string;
  analysisId?: string;
  sessionId?: string;
}

const SheetStatusIcon = ({ status }: { status: SheetAnalysisStatus['status'] }) => {
  switch (status) {
    case 'queued':
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return null;
  }
};

export function DocumentAnalysisResults({
  uploadId,
  filename,
  analysisId,
  sessionId
}: DocumentAnalysisResultsProps) {
  const [analysisData, setAnalysisData] = useState<AnalysisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('summary');
  const [expandedCode, setExpandedCode] = useState<Record<string, boolean>>({});

  const fetchAnalysisStatus = useCallback(async () => {
    try {
      const url = `/api/chat/uploads/${uploadId}/analysis${sessionId ? `?sessionId=${sessionId}` : ''}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to fetch analysis status');
      }
      
      const data: AnalysisResponse = await res.json();
      setAnalysisData(data);
      setError(null);
      
      return data.status;
    } catch (err: any) {
      setError(err.message || 'Failed to fetch analysis');
      return 'failed';
    } finally {
      setIsLoading(false);
    }
  }, [uploadId, sessionId]);

  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    let isMounted = true;

    const poll = async () => {
      const status = await fetchAnalysisStatus();
      
      if (!isMounted) return;
      
      if (status === 'pending' || status === 'analyzing') {
        pollInterval = setTimeout(poll, 2000);
      }
    };

    poll();

    return () => {
      isMounted = false;
      if (pollInterval) {
        clearTimeout(pollInterval);
      }
    };
  }, [fetchAnalysisStatus]);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    fetchAnalysisStatus();
  }, [fetchAnalysisStatus]);

  const toggleCodeExpanded = useCallback((sheetName: string) => {
    setExpandedCode(prev => ({
      ...prev,
      [sheetName]: !prev[sheetName]
    }));
  }, []);

  const progressPercent = useMemo(() => {
    if (!analysisData?.progress) return 0;
    const { currentSheet, totalSheets } = analysisData.progress;
    return Math.round((currentSheet / totalSheets) * 100);
  }, [analysisData?.progress]);

  const displayFilename = useMemo(() => {
    const maxLen = 35;
    if (filename.length <= maxLen) return filename;
    const ext = filename.split('.').pop() || '';
    const name = filename.slice(0, filename.length - ext.length - 1);
    const truncated = name.slice(0, maxLen - ext.length - 4) + '...';
    return `${truncated}.${ext}`;
  }, [filename]);

  if (isLoading && !analysisData) {
    return (
      <Card className="w-full max-w-2xl" data-testid="document-analysis-loading">
        <CardContent className="py-6">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading analysis...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !analysisData) {
    return (
      <Card className="w-full max-w-2xl border-red-200" data-testid="document-analysis-error">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="h-7 text-xs"
              data-testid="retry-analysis-button"
            >
              <RefreshCw className="h-3 w-3 mr-1.5" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!analysisData) return null;

  const { status, progress, results } = analysisData;

  if (status === 'pending' || status === 'analyzing') {
    return (
      <Card className="w-full max-w-2xl" data-testid="document-analysis-progress">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-green-600" />
            <CardTitle className="text-sm font-medium" data-testid="analysis-filename">
              {displayFilename}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm text-muted-foreground" data-testid="analysis-status-text">
                {progress 
                  ? `Analyzing sheet ${progress.currentSheet} of ${progress.totalSheets}`
                  : 'Preparing analysis...'}
              </span>
            </div>
            
            <Progress value={progressPercent} className="h-2" data-testid="analysis-progress-bar" />
            
            {progress?.sheets && progress.sheets.length > 0 && (
              <div className="space-y-1.5 mt-3">
                {progress.sheets.map((sheet) => (
                  <div
                    key={sheet.sheetName}
                    className="flex items-center gap-2 text-xs"
                    data-testid={`sheet-status-${sheet.sheetName}`}
                  >
                    <SheetStatusIcon status={sheet.status} />
                    <span className={cn(
                      "truncate max-w-[200px]",
                      sheet.status === 'running' && "font-medium text-foreground",
                      sheet.status === 'done' && "text-muted-foreground",
                      sheet.status === 'queued' && "text-muted-foreground",
                      sheet.status === 'failed' && "text-red-600"
                    )}>
                      {sheet.sheetName}
                    </span>
                    {sheet.status === 'failed' && sheet.error && (
                      <span className="text-red-500 truncate max-w-[150px]">
                        - {sheet.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === 'failed') {
    return (
      <Card className="w-full max-w-2xl border-red-200" data-testid="document-analysis-failed">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <CardTitle className="text-sm font-medium text-red-700">
              Analysis Failed
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground mb-3">
            {analysisData.error || 'An error occurred during analysis.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="h-7 text-xs"
            data-testid="retry-analysis-button"
          >
            <RefreshCw className="h-3 w-3 mr-1.5" />
            Retry Analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === 'completed' && results) {
    const sheetResults = results.sheets || [];
    const hasSummary = !!results.crossSheetSummary;
    const defaultTab = hasSummary ? 'summary' : (sheetResults[0]?.sheetName || 'summary');

    return (
      <Card className="w-full max-w-2xl" data-testid="document-analysis-results">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            <CardTitle className="text-sm font-medium" data-testid="analysis-results-title">
              Analysis Complete: {displayFilename}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            defaultValue={defaultTab}
            className="w-full"
          >
            <TabsList className="w-full h-8 bg-muted/50 p-0.5 overflow-x-auto flex-nowrap justify-start">
              {hasSummary && (
                <TabsTrigger
                  value="summary"
                  className="text-xs h-7 px-2.5"
                  data-testid="tab-summary"
                >
                  Summary
                </TabsTrigger>
              )}
              {sheetResults.map((sheet) => (
                <TabsTrigger
                  key={sheet.sheetName}
                  value={sheet.sheetName}
                  className="text-xs h-7 px-2.5 max-w-[100px] truncate"
                  data-testid={`tab-sheet-${sheet.sheetName}`}
                >
                  {sheet.sheetName}
                </TabsTrigger>
              ))}
            </TabsList>

            {hasSummary && (
              <TabsContent value="summary" className="mt-3" data-testid="content-summary">
                <div className="text-sm text-muted-foreground leading-relaxed">
                  {results.crossSheetSummary}
                </div>
              </TabsContent>
            )}

            {sheetResults.map((sheet) => (
              <TabsContent
                key={sheet.sheetName}
                value={sheet.sheetName}
                className="mt-3 space-y-3"
                data-testid={`content-sheet-${sheet.sheetName}`}
              >
                {sheet.error ? (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="h-4 w-4" />
                    <span>{sheet.error}</span>
                  </div>
                ) : (
                  <>
                    {sheet.generatedCode && (
                      <Collapsible
                        open={expandedCode[sheet.sheetName] || false}
                        onOpenChange={() => toggleCodeExpanded(sheet.sheetName)}
                      >
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-between h-8 text-xs hover:bg-muted/50"
                            data-testid={`toggle-code-${sheet.sheetName}`}
                          >
                            <span className="flex items-center gap-1.5">
                              <Code className="h-3.5 w-3.5" />
                              Generated Code
                            </span>
                            <ChevronDown className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              expandedCode[sheet.sheetName] && "rotate-180"
                            )} />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <pre 
                            className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-[180px] font-mono"
                            data-testid={`code-block-${sheet.sheetName}`}
                          >
                            <code>{sheet.generatedCode}</code>
                          </pre>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {sheet.summary && (
                      <div className="text-sm text-muted-foreground" data-testid={`summary-${sheet.sheetName}`}>
                        {sheet.summary}
                      </div>
                    )}

                    {sheet.metrics && sheet.metrics.length > 0 && (
                      <div className="grid grid-cols-2 gap-2" data-testid={`metrics-${sheet.sheetName}`}>
                        {sheet.metrics.map((metric, idx) => (
                          <div
                            key={idx}
                            className="bg-muted/50 rounded-lg p-2.5 border border-border/50"
                          >
                            <div className="text-xs text-muted-foreground">{metric.label}</div>
                            <div className="text-sm font-medium text-foreground">{metric.value}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {sheet.preview && sheet.preview.headers.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border border-border" data-testid={`preview-${sheet.sheetName}`}>
                        <table className="min-w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>
                              {sheet.preview.headers.map((header, idx) => (
                                <th
                                  key={idx}
                                  className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-border"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sheet.preview.rows.slice(0, 5).map((row, rowIdx) => (
                              <tr key={rowIdx} className="border-b border-border last:border-0">
                                {row.map((cell, cellIdx) => (
                                  <td key={cellIdx} className="px-2 py-1.5 text-foreground">
                                    {cell === null || cell === undefined ? (
                                      <span className="text-muted-foreground/50">—</span>
                                    ) : (
                                      String(cell)
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sheet.preview.rows.length > 5 && (
                          <div className="px-2 py-1 text-xs text-muted-foreground bg-muted/30 border-t border-border">
                            + {sheet.preview.rows.length - 5} more rows
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    );
  }

  return null;
}

export default DocumentAnalysisResults;
