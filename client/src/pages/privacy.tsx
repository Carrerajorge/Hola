import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Shield, Eye, Download, Trash2, Lock, History, FileText } from "lucide-react";

export default function PrivacyPage() {
  const [, setLocation] = useLocation();
  const [shareData, setShareData] = useState(false);
  const [saveHistory, setSaveHistory] = useState(true);
  const [analyticsTracking, setAnalyticsTracking] = useState(true);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-privacy"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Privacidad</h1>
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Control de datos</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Compartir datos de uso</p>
                    <p className="text-sm text-muted-foreground">Ayuda a mejorar el servicio</p>
                  </div>
                </div>
                <Switch 
                  checked={shareData} 
                  onCheckedChange={setShareData}
                  data-testid="switch-share-data"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Eye className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Seguimiento de análisis</p>
                    <p className="text-sm text-muted-foreground">Estadísticas anónimas de uso</p>
                  </div>
                </div>
                <Switch 
                  checked={analyticsTracking} 
                  onCheckedChange={setAnalyticsTracking}
                  data-testid="switch-analytics"
                />
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Historial</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <History className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Guardar historial de chat</p>
                    <p className="text-sm text-muted-foreground">Conservar conversaciones anteriores</p>
                  </div>
                </div>
                <Switch 
                  checked={saveHistory} 
                  onCheckedChange={setSaveHistory}
                  data-testid="switch-save-history"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Trash2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Borrar historial</p>
                    <p className="text-sm text-muted-foreground">Eliminar todas las conversaciones</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" data-testid="button-clear-history">
                  Borrar todo
                </Button>
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Tus datos</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Download className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Descargar mis datos</p>
                    <p className="text-sm text-muted-foreground">Exportar toda tu información</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" data-testid="button-download-data">
                  Descargar
                </Button>
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Política de privacidad</p>
                    <p className="text-sm text-muted-foreground">Leer términos completos</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" data-testid="button-privacy-policy">
                  Ver
                </Button>
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Trash2 className="h-5 w-5 text-red-500" />
                <div>
                  <p className="font-medium text-red-600 dark:text-red-400">Eliminar cuenta</p>
                  <p className="text-sm text-red-500/80">Esta acción es permanente e irreversible</p>
                </div>
              </div>
              <Button variant="destructive" size="sm" data-testid="button-delete-account">
                Eliminar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
