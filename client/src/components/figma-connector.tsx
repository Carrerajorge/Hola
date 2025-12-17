import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plug, Link, Code, Palette, Copy, Check, ExternalLink, FileCode, Unplug } from "lucide-react";

interface FigmaConnectorProps {
  open: boolean;
  onClose: () => void;
  onCodeGenerated?: (code: string, type: "react" | "html" | "css") => void;
}

interface DesignToken {
  name: string;
  type: "color" | "typography" | "spacing" | "effect";
  value: any;
}

interface CodeContext {
  html: string;
  css: string;
  react: string;
  tokens: DesignToken[];
}

export function FigmaConnector({ open, onClose, onCodeGenerated }: FigmaConnectorProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [figmaUrl, setFigmaUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [codeContext, setCodeContext] = useState<CodeContext | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("connect");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      checkConnectionStatus();
    }
  }, [open]);

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch("/api/figma/status");
      const data = await response.json();
      setIsConnected(data.connected);
      if (data.connected) {
        setActiveTab("design");
      }
    } catch (error) {
      console.error("Error checking Figma status:", error);
    }
  };

  const handleConnect = async () => {
    if (!accessToken.trim()) {
      toast({
        title: "Error",
        description: "Por favor ingresa tu token de acceso de Figma",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    try {
      const response = await fetch("/api/figma/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: accessToken.trim() }),
      });

      const data = await response.json();
      if (response.ok) {
        setIsConnected(true);
        setActiveTab("design");
        toast({
          title: "Conectado",
          description: "Figma conectado exitosamente",
        });
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast({
        title: "Error de conexión",
        description: error.message || "No se pudo conectar a Figma",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch("/api/figma/disconnect", { method: "POST" });
      setIsConnected(false);
      setAccessToken("");
      setCodeContext(null);
      setActiveTab("connect");
      toast({
        title: "Desconectado",
        description: "Figma desconectado exitosamente",
      });
    } catch (error) {
      console.error("Error disconnecting:", error);
    }
  };

  const handleFetchDesign = async () => {
    if (!figmaUrl.trim()) {
      toast({
        title: "Error",
        description: "Por favor ingresa una URL de Figma",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const parseResponse = await fetch("/api/figma/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: figmaUrl.trim() }),
      });

      if (!parseResponse.ok) {
        throw new Error("URL de Figma inválida");
      }

      const { fileKey, nodeId } = await parseResponse.json();

      const codeResponse = await fetch("/api/figma/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey, nodeId }),
      });

      if (!codeResponse.ok) {
        const error = await codeResponse.json();
        throw new Error(error.error || "Error al obtener el diseño");
      }

      const context = await codeResponse.json();
      setCodeContext(context);
      setActiveTab("code");
      
      toast({
        title: "Diseño obtenido",
        description: `Se encontraron ${context.tokens.length} tokens de diseño`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "No se pudo obtener el diseño",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedCode(type);
    setTimeout(() => setCopiedCode(null), 2000);
    toast({
      title: "Copiado",
      description: `Código ${type} copiado al portapapeles`,
    });
  };

  const insertCode = (code: string, type: "react" | "html" | "css") => {
    onCodeGenerated?.(code, type);
    toast({
      title: "Código insertado",
      description: `Código ${type.toUpperCase()} agregado al chat`,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Figma MCP Connector
          </DialogTitle>
          <DialogDescription>
            Conecta tu cuenta de Figma para extraer diseños, tokens y generar código
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="connect" className="flex items-center gap-2">
              <Plug className="h-4 w-4" />
              Conectar
            </TabsTrigger>
            <TabsTrigger value="design" disabled={!isConnected} className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              Diseño
            </TabsTrigger>
            <TabsTrigger value="code" disabled={!codeContext} className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Código
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connect" className="space-y-4 mt-4">
            {isConnected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <Check className="h-5 w-5 text-green-500" />
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    Conectado a Figma
                  </span>
                </div>
                <Button variant="outline" onClick={handleDisconnect} className="w-full">
                  <Unplug className="h-4 w-4 mr-2" />
                  Desconectar
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="figma-token">Token de Acceso Personal de Figma</Label>
                  <Input
                    id="figma-token"
                    type="password"
                    placeholder="figd_..."
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    data-testid="input-figma-token"
                  />
                  <p className="text-xs text-muted-foreground">
                    Genera un token en{" "}
                    <a
                      href="https://www.figma.com/developers/api#access-tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Figma Settings <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                </div>
                <Button 
                  onClick={handleConnect} 
                  disabled={isConnecting}
                  className="w-full"
                  data-testid="button-connect-figma"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Conectando...
                    </>
                  ) : (
                    <>
                      <Plug className="h-4 w-4 mr-2" />
                      Conectar a Figma
                    </>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="design" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="figma-url">URL del diseño de Figma</Label>
              <div className="flex gap-2">
                <Input
                  id="figma-url"
                  placeholder="https://www.figma.com/design/..."
                  value={figmaUrl}
                  onChange={(e) => setFigmaUrl(e.target.value)}
                  className="flex-1"
                  data-testid="input-figma-url"
                />
                <Button 
                  onClick={handleFetchDesign} 
                  disabled={isLoading}
                  data-testid="button-fetch-design"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Obtener"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Copia la URL de tu archivo o frame de Figma. Puedes incluir un node-id específico.
              </p>
            </div>

            {codeContext && codeContext.tokens.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  Tokens de Diseño ({codeContext.tokens.length})
                </Label>
                <ScrollArea className="h-48 rounded-md border p-3">
                  <div className="space-y-2">
                    {codeContext.tokens.slice(0, 20).map((token, index) => (
                      <div 
                        key={index} 
                        className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                      >
                        <span className="font-mono text-xs truncate max-w-[200px]">
                          {token.name}
                        </span>
                        {token.type === "color" && token.value.hex && (
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-6 h-6 rounded border" 
                              style={{ backgroundColor: token.value.hex }}
                            />
                            <span className="font-mono text-xs">{token.value.hex}</span>
                          </div>
                        )}
                        {token.type === "typography" && (
                          <span className="text-xs text-muted-foreground">
                            {token.value.fontFamily} {token.value.fontSize}px
                          </span>
                        )}
                      </div>
                    ))}
                    {codeContext.tokens.length > 20 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        +{codeContext.tokens.length - 20} más tokens...
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </TabsContent>

          <TabsContent value="code" className="space-y-4 mt-4">
            {codeContext && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <FileCode className="h-4 w-4" />
                      React Component
                    </Label>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => copyToClipboard(codeContext.react, "react")}
                      >
                        {copiedCode === "react" ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => insertCode(codeContext.react, "react")}
                      >
                        Insertar
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="h-48 rounded-md border bg-muted/30">
                    <pre className="p-3 text-xs font-mono overflow-x-auto">
                      {codeContext.react}
                    </pre>
                  </ScrollArea>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>CSS Variables</Label>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => copyToClipboard(codeContext.css, "css")}
                      >
                        {copiedCode === "css" ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => insertCode(codeContext.css, "css")}
                      >
                        Insertar
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="h-32 rounded-md border bg-muted/30">
                    <pre className="p-3 text-xs font-mono overflow-x-auto">
                      {codeContext.css}
                    </pre>
                  </ScrollArea>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
