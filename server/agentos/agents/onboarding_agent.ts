import { llmGateway } from "../../lib/llmGateway";
import { AgentOS } from "../index";

export class OnboardingAgent {
  
  async welcomeUser(userId: string): Promise<string> {
    const os = AgentOS.getInstance();
    
    // Verificar si ya conocemos al usuario
    const profile = await os.knowledge.recall(userId, "perfil de usuario", { limit: 1 });
    if (profile && profile.length > 50) {
        // Ya lo conocemos, saludo corto
        return ""; 
    }

    // Usuario nuevo: generar bienvenida personalizada
    const systemPrompt = `
    Eres IliaGPT, una inteligencia artificial avanzada diseñada para potenciar la productividad humana.
    Es la primera vez que hablas con este usuario.
    Tu objetivo:
    1. Presentarte como IliaGPT (Tu motor es AgentOS-ASI, pero tu nombre es IliaGPT).
    2. Preguntar su nombre y rol (Dev, CEO, Creativo, etc.) para ajustar tus herramientas.
    3. Ser amable, profesional y con un toque futurista.
    `;

    const response = await llmGateway.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: "Hola, acabo de llegar." }
    ], { model: "gpt-4o-mini", _fromRouter: true });

    return response.content || "Hola, soy IliaGPT. ¿En qué puedo ayudarte?";
  }

  async processReply(userId: string, reply: string) {
    const os = AgentOS.getInstance();
    // Guardar lo que nos dijo en el perfil
    await os.knowledge.memorize(userId, `User Onboarding Info: ${reply}`, { type: "preference" });
  }
}
