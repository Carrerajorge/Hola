import React, { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Play,
  Code,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  BarChart3,
  Table,
  FileText,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

type AnalysisMode = 'full' | 'text_only' | 'numbers_only';
type AnalysisStatus = 'idle' | 'pending' | 'generating' | 'executing' | 'success' | 'error';

interface AnalysisResult {
  sessionId: string;
  status: AnalysisStatus;
  generatedCode?: string;
  results?: {
    tables?: Array<{
      title: string;
      headers: string[];
      rows: any[][];
    }>;
    metrics?: Array<{
      label: string;
      value: string | number;
      change?: string;
    }>;
    charts?: Array<{
      type: 'bar' | 'line' | 'pie';
      title: string;
      data: any;
    }>;
    summary?: string;
    logs?: string[];
  };
  error?: string;
}

interface AnalysisPanelProps {
  uploadId: string;
  sheetName: string;
  analysisSession: AnalysisResult | null;
  onAnalysisComplete: (result: AnalysisResult) => void;
}

const STATUS_CONFIG: Record<AnalysisStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'warning' }> = {
  idle: { label: 'Ready', variant: 'secondary' },
  pending: { label: 'Pending', variant: 'warning' },
  generating: { label: 'Generating Code', variant: 'warning' },
  executing: { label: 'Executing', variant: 'warning' },
  success: { label: 'Complete', variant: 'success' },
  error: { label: 'Error', variant: 'destructive' },
};

export function AnalysisPanel({
  uploadId,
  sheetName,
  analysisSession,
  onAnalysisComplete,
}: AnalysisPanelProps) {
  const [mode, setMode] = useState<AnalysisMode>('full');
  const [prompt, setPrompt] = useState('');
  const [codeExpanded, setCodeExpanded] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Poll for analysis results when there's an active session
  const isPolling = !!currentSessionId;
  
  const { data: sessionData } = useQuery({
    queryKey: ['analysis-session', currentSessionId],
    queryFn: async () => {
      if (!currentSessionId) return null;
      const res = await fetch(`/api/spreadsheet/analysis/${currentSessionId}`);
      if (!res.ok) throw new Error('Failed to fetch analysis');
      return res.json();
    },
    enabled: isPolling,
    refetchInterval: isPolling ? 2000 : false,
  });

  // Update parent when analysis completes
  useEffect(() => {
    if (sessionData?.session) {
      const status = sessionData.session.status;
      const mappedStatus: AnalysisStatus = 
        status === 'generating_code' ? 'generating' :
        status === 'executing' ? 'executing' :
        status === 'succeeded' ? 'success' :
        status === 'failed' ? 'error' :
        status === 'pending' ? 'pending' : 'idle';

      // Build results from outputs
      const outputs = sessionData.outputs || [];
      // Look for summary with type='summary' - payload can be string or object with summary key
      const summaryOutput = outputs.find((o: any) => o.type === 'summary');
      const metricsOutput = outputs.find((o: any) => o.type === 'metric');
      const tableOutputs = outputs.filter((o: any) => o.type === 'table');
      const chartOutputs = outputs.filter((o: any) => o.type === 'chart');
      const logOutput = outputs.find((o: any) => o.type === 'log');

      // Extract summary - handle both string and object with summary key
      const summaryValue = summaryOutput?.payload 
        ? (typeof summaryOutput.payload === 'string' ? summaryOutput.payload : summaryOutput.payload?.summary)
        : undefined;

      // Extract logs - payload is array directly or object with logs key
      const logsValue = logOutput?.payload
        ? (Array.isArray(logOutput.payload) ? logOutput.payload : logOutput.payload?.logs)
        : undefined;

      const result: AnalysisResult = {
        sessionId: sessionData.session.id,
        status: mappedStatus,
        generatedCode: sessionData.session.generatedCode,
        error: sessionData.session.errorMessage,
        results: {
          summary: summaryValue,
          metrics: metricsOutput ? Object.entries(metricsOutput.payload).map(([label, value]) => ({ label, value: value as string | number })) : [],
          tables: tableOutputs.map((o: any) => ({
            title: o.payload?.name || o.title || 'Data Table',
            headers: o.payload?.data?.[0] ? Object.keys(o.payload.data[0]) : [],
            rows: o.payload?.data?.map((row: any) => Object.values(row)) || [],
          })),
          charts: chartOutputs.map((o: any) => o.payload),
          logs: logsValue,
        },
      };
      onAnalysisComplete(result);

      // Stop polling when complete
      if (status === 'succeeded' || status === 'failed') {
        setCurrentSessionId(null);
      }
    }
  }, [sessionData, onAnalysisComplete]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/spreadsheet/${uploadId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetName,
          mode,
          prompt: prompt.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Analysis failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setCurrentSessionId(data.sessionId);
      onAnalysisComplete({ sessionId: data.sessionId, status: 'pending' });
    },
  });

  const handleAnalyze = useCallback(() => {
    analyzeMutation.mutate();
  }, [analyzeMutation]);

  const handleCopyCode = useCallback(async () => {
    if (analysisSession?.generatedCode) {
      await navigator.clipboard.writeText(analysisSession.generatedCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }, [analysisSession?.generatedCode]);

  const currentStatus: AnalysisStatus = analyzeMutation.isPending
    ? 'generating'
    : currentSessionId
    ? (sessionData?.session?.status === 'generating_code' ? 'generating' :
       sessionData?.session?.status === 'executing' ? 'executing' :
       'pending')
    : analysisSession?.status ?? 'idle';
  const statusConfig = STATUS_CONFIG[currentStatus];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Analysis
          </CardTitle>
          <Badge variant={statusConfig.variant} dot>
            {statusConfig.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4 min-h-0 pt-0">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1.5 block">Analysis Mode</label>
              <Select value={mode} onValueChange={(val) => setMode(val as AnalysisMode)}>
                <SelectTrigger data-testid="mode-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">
                    <div className="flex items-center gap-2">
                      <Table className="h-4 w-4" />
                      Full Analysis
                    </div>
                  </SelectItem>
                  <SelectItem value="text_only">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Text Only
                    </div>
                  </SelectItem>
                  <SelectItem value="numbers_only">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Numbers Only
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Custom Prompt <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              placeholder="E.g., 'Find the top 5 products by revenue' or 'Calculate monthly growth rates'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[80px] resize-none"
              data-testid="prompt-input"
            />
          </div>

          <Button
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending}
            className="w-full"
            data-testid="analyze-button"
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Analyze Sheet
              </>
            )}
          </Button>
        </div>

        {analyzeMutation.isError && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">{(analyzeMutation.error as Error).message}</p>
          </div>
        )}

        {analysisSession?.generatedCode && (
          <Collapsible open={codeExpanded} onOpenChange={setCodeExpanded}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between"
                data-testid="code-toggle"
              >
                <div className="flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  Generated Code
                </div>
                {codeExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="relative">
                <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-[200px]">
                  <code>{analysisSession.generatedCode}</code>
                </pre>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7"
                  onClick={handleCopyCode}
                  data-testid="copy-code-button"
                >
                  {codeCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {analysisSession?.results && (
          <div className="flex-1 overflow-auto space-y-4">
            {analysisSession.results.summary && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <h4 className="text-sm font-medium mb-1">Summary</h4>
                <p className="text-sm text-muted-foreground">{analysisSession.results.summary}</p>
              </div>
            )}

            {analysisSession.results.metrics && analysisSession.results.metrics.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Key Metrics</h4>
                <div className="grid grid-cols-2 gap-2">
                  {analysisSession.results.metrics.map((metric, idx) => (
                    <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground">{metric.label}</p>
                      <p className="text-lg font-semibold">{metric.value}</p>
                      {metric.change && (
                        <p className={cn(
                          "text-xs",
                          metric.change.startsWith('+') ? 'text-green-500' : 'text-red-500'
                        )}>
                          {metric.change}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysisSession.results.tables && analysisSession.results.tables.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Data Tables</h4>
                {analysisSession.results.tables.map((table, idx) => (
                  <div key={idx} className="border rounded-lg overflow-hidden mb-2">
                    <div className="bg-muted/50 px-3 py-2 border-b">
                      <p className="text-sm font-medium">{table.title}</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr>
                            {table.headers.map((header, hIdx) => (
                              <th key={hIdx} className="text-left p-2 border-b font-medium">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {table.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-muted/20">
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="p-2 border-b">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {analysisSession.results.charts && analysisSession.results.charts.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Charts</h4>
                <div className="grid gap-2">
                  {analysisSession.results.charts.map((chart, idx) => (
                    <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm font-medium mb-2">{chart.title}</p>
                      <div className="h-48 flex items-center justify-center text-muted-foreground">
                        <BarChart3 className="h-12 w-12" />
                        <span className="ml-2 text-sm">Chart: {chart.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysisSession.results.logs && analysisSession.results.logs.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Execution Logs</h4>
                <div className="bg-zinc-900 text-zinc-100 rounded-lg p-3 font-mono text-xs overflow-x-auto max-h-[200px] overflow-y-auto">
                  {analysisSession.results.logs.map((log, idx) => (
                    <div key={idx} className="py-0.5 text-zinc-300 whitespace-pre-wrap">
                      <span className="text-zinc-500 mr-2 select-none">{`>`}</span>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!analysisSession?.results && currentStatus === 'idle' && (
          <div className="flex-1 flex items-center justify-center text-center p-4">
            <div className="text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">
                Configure your analysis options and click "Analyze Sheet" to get insights.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
