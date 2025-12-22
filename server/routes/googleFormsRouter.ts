import { Router, Request, Response } from "express";
import { generateGoogleForm } from "../services/googleFormsService";

export function createGoogleFormsRouter(): Router {
  const router = Router();

  router.post("/generate", async (req: Request, res: Response) => {
    try {
      const { prompt, title } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ 
          error: "Se requiere una descripción del formulario" 
        });
      }

      const form = await generateGoogleForm(prompt, title);

      res.json({
        success: true,
        formId: form.formId,
        title: form.title,
        description: form.description,
        questions: form.questions,
        responderUrl: form.responderUrl,
        editUrl: form.editUrl
      });
    } catch (error: any) {
      console.error("Error generating Google Form:", error);
      res.status(500).json({ 
        error: "Error al generar el formulario",
        details: error.message 
      });
    }
  });

  return router;
}
