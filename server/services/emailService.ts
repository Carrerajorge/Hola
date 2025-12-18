interface ShareNotificationParams {
  toEmail: string;
  chatTitle: string;
  chatId: string;
  role: string;
  inviterEmail: string;
}

export async function sendShareNotificationEmail(params: ShareNotificationParams): Promise<void> {
  const { toEmail, chatTitle, chatId, role, inviterEmail } = params;
  
  const roleLabels: Record<string, string> = {
    owner: "propietario",
    editor: "editor",
    viewer: "visualizador"
  };
  
  const roleLabel = roleLabels[role] || role;
  const shareUrl = `${process.env.REPLIT_DEV_DOMAIN || 'https://siragpt.app'}/chat/${chatId}`;
  
  const subject = `${inviterEmail} te ha compartido una conversación en Sira GPT`;
  const body = `
¡Hola!

${inviterEmail} te ha invitado a participar en una conversación en Sira GPT.

📝 Conversación: "${chatTitle}"
👤 Tu rol: ${roleLabel}
🔗 Enlace: ${shareUrl}

Haz clic en el enlace para acceder a la conversación.

---
Sira GPT - Tu asistente de IA
`;

  console.log(`📧 Email notification:`);
  console.log(`   To: ${toEmail}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Body: ${body}`);
  
  return Promise.resolve();
}
