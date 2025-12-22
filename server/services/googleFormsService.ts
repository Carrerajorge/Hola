import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface FormQuestion {
  id: string;
  title: string;
  type: "text" | "paragraph" | "multiple_choice" | "checkbox" | "dropdown";
  options?: string[];
  required: boolean;
}

interface GeneratedForm {
  title: string;
  description: string;
  questions: FormQuestion[];
  responderUrl: string;
  editUrl: string;
  formId: string;
}

export async function generateGoogleForm(prompt: string, customTitle?: string): Promise<GeneratedForm> {
  const systemPrompt = `Eres un experto en crear formularios de Google. Dado un prompt del usuario, genera un JSON con la estructura del formulario.

IMPORTANTE: Responde SOLO con un JSON válido, sin markdown, sin explicaciones.

Formato de respuesta:
{
  "title": "Título del formulario",
  "description": "Descripción breve del formulario",
  "questions": [
    {
      "id": "q1",
      "title": "Pregunta 1",
      "type": "text|paragraph|multiple_choice|checkbox|dropdown",
      "options": ["opción 1", "opción 2"] (solo para multiple_choice, checkbox, dropdown),
      "required": true|false
    }
  ]
}

Tipos de preguntas disponibles:
- text: Respuesta corta de texto
- paragraph: Respuesta larga (párrafo)
- multiple_choice: Selección única (radio buttons)
- checkbox: Selección múltiple
- dropdown: Lista desplegable

Crea entre 5-15 preguntas relevantes y bien estructuradas. Usa variedad de tipos de preguntas.`;

  const model = genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: `${systemPrompt}\n\nPrompt del usuario: ${prompt}${customTitle ? `\nTítulo preferido: ${customTitle}` : ""}` }] }
    ],
    config: {
      temperature: 0.7,
      maxOutputTokens: 2000,
    }
  });

  const response = await model;
  const text = response.text || "";
  
  let jsonText = text.trim();
  if (jsonText.startsWith("```json")) {
    jsonText = jsonText.slice(7);
  }
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith("```")) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  let formData: { title: string; description: string; questions: FormQuestion[] };
  try {
    formData = JSON.parse(jsonText);
  } catch (e) {
    console.error("Failed to parse form JSON:", e, jsonText);
    throw new Error("Error al generar la estructura del formulario");
  }

  if (customTitle) {
    formData.title = customTitle;
  }

  const formId = `form_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const responderUrl = `https://docs.google.com/forms/d/e/${formId}/viewform`;
  const editUrl = `https://docs.google.com/forms/d/${formId}/edit`;

  return {
    title: formData.title,
    description: formData.description,
    questions: formData.questions.map((q, idx) => ({
      ...q,
      id: q.id || `q${idx + 1}`
    })),
    responderUrl,
    editUrl,
    formId
  };
}
