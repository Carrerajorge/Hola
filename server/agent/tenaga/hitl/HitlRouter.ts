import { Router } from "express";
import { hitlManager } from "./HitlManager";

export const hitlRouter = Router();

// Endpoint para que React consulte si hay alguna petición pendiente de aprobación
hitlRouter.get("/pending", (req, res) => {
  const pending = hitlManager.getPendingEscalations();
  res.json({ success: true, pending });
});

// Endpoint para que React envíe la aprobación/rechazo
hitlRouter.post("/resolve", (req, res) => {
  const { escalationId, approved } = req.body;
  
  if (!escalationId || typeof approved !== "boolean") {
    return res.status(400).json({ success: false, error: "Invalid payload" });
  }

  const success = hitlManager.resolveEscalation(escalationId, approved);
  
  if (success) {
    res.json({ success: true, message: "Escalation resolved" });
  } else {
    res.status(404).json({ success: false, error: "Escalation ID not found or already resolved" });
  }
});
