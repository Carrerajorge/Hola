const fs = require('fs');
const content = fs.readFileSync('server/routes/localControlRouter.ts', 'utf8');

const newRoute = `
router.get("/local/pick-folder", async (req, res) => {
  try {
    const { exec } = await import("child_process");
    exec('osascript -e \\'choose folder with prompt "Selecciona una carpeta para modificar su código"\\' -e \\'POSIX path of result\\'', (error, stdout) => {
      if (error) {
        return res.status(500).json({ success: false, error: "Carpeta no seleccionada o cancelado" });
      }
      const path = stdout.trim();
      return res.json({ success: true, path });
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Error al abrir seleccionador de carpetas" });
  }
});
`;

const updated = content.replace('router.get("/local/repo/folders",', newRoute + '\nrouter.get("/local/repo/folders",');
fs.writeFileSync('server/routes/localControlRouter.ts', updated);
console.log("Patched localControlRouter.ts");
