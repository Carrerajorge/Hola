const fs = require('fs');
const content = fs.readFileSync('client/src/components/sidebar.tsx', 'utf8');

const regex = /const pickLocalFolderPath = useCallback\(async \(\): Promise<string \| null> => \{[\s\S]*?\}, \[\]\);/g;

const replacement = `const pickLocalFolderPath = useCallback(async (): Promise<string | null> => {
    if (typeof window !== "undefined" && (window as any).electronAPI?.pickWorkspaceFolder) {
      return (window as any).electronAPI.pickWorkspaceFolder();
    }

    try {
      const res = await fetch("/api/local/pick-folder");
      const data = await res.json();
      if (data.success && data.path) {
        return data.path;
      }
    } catch (e) {
      console.error("Local pick folder failed", e);
    }

    if (typeof window !== "undefined" && typeof window.prompt === "function") {
      const manualPath = window.prompt("Pega la ruta absoluta de la carpeta local que quieres abrir");
      return manualPath?.trim() ? manualPath.trim() : null;
    }

    return null;
  }, []);`;

const updated = content.replace(regex, replacement);
fs.writeFileSync('client/src/components/sidebar.tsx', updated);
console.log("Patched sidebar.tsx", content !== updated);
