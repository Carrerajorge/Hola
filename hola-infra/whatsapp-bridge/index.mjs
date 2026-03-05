
import express from "express";

import makeWASocket, {

  useMultiFileAuthState,

  fetchLatestBaileysVersion,

  DisconnectReason,

} from "@whiskeysockets/baileys";



const PORT = Number(process.env.PORT || 9106);

const TO = process.env.WHATSAPP_TO; // 51981996436@s.whatsapp.net

const TOKEN = process.env.ALERTMANAGER_WEBHOOK_TOKEN;

const PAIR_PHONE = process.env.WHATSAPP_PAIRING_PHONE; // 51981996436



if (!TO) throw new Error("Missing env WHATSAPP_TO (e.g. 51981996436@s.whatsapp.net)");

if (!TOKEN) throw new Error("Missing env ALERTMANAGER_WEBHOOK_TOKEN");



const { state, saveCreds } = await useMultiFileAuthState("./auth");

const { version } = await fetchLatestBaileysVersion();



let sock;



function iconFor(alertname = "", severity = "warning", status = "firing") {
  const sevIcon = severity === "critical" ? "🚨" : severity === "warning" ? "⚠️" : "ℹ️";
  const statusIcon = status === "resolved" ? "✅" : "🔥";

  const name = alertname.toLowerCase();
  let metricIcon = "📣";
  if (name.includes("cpu")) metricIcon = "🧠";
  else if (name.includes("memory") || name.includes("ram")) metricIcon = "🧵";
  else if (name.includes("disk")) metricIcon = "💾";
  else if (name.includes("down")) metricIcon = "📉";

  return `${sevIcon}${statusIcon} ${metricIcon}`;
}

function fmtAlert(a) {
  const name = a.labels?.alertname || "Alert";
  const sev = a.labels?.severity || "warning";
  const inst = a.labels?.instance || a.labels?.job || "unknown";
  const mount = a.labels?.mountpoint ? ` ${a.labels.mountpoint}` : "";
  const summary = a.annotations?.summary || "";
  const desc = a.annotations?.description || "";
  const status = a.status || "firing";

  const head = `${iconFor(name, sev, status)} ${summary || name}`;
  const meta = `host: ${inst}${mount} | sev: ${sev} | state: ${status}`;
  const body = desc ? `\n${desc}` : "";

  return `${head}\n${meta}${body}`;
}

async function startSock() {

  sock = makeWASocket({

    version,

    auth: state,

  });



  sock.ev.on("creds.update", saveCreds);



  sock.ev.on("connection.update", async (update) => {

    const { connection, qr, lastDisconnect } = update;



    if (qr) {

      console.log("\n[whatsapp-bridge] QR payload (fallback):\n");

      console.log(qr);

      console.log("\n");

    }



    if (connection) console.log(`[whatsapp-bridge] connection=${connection}`);



    if (connection === "open") {

      console.log("[whatsapp-bridge] logged in ✅");

    }



    if (connection === "close") {

      const statusCode = lastDisconnect?.error?.output?.statusCode;

      const reason = lastDisconnect?.error?.output?.payload?.message || lastDisconnect?.error?.message;

      console.error("[whatsapp-bridge] disconnected:", statusCode, reason);



      // If logged out, it requires re-pairing (auth cleared)

      if (statusCode === DisconnectReason.loggedOut) {

        console.error("[whatsapp-bridge] logged out. Delete auth volume and pair again.");

        return;

      }



      // Otherwise retry reconnect

      setTimeout(() => startSock().catch(console.error), 3000);

    }

  });



  // Pairing code ONLY when not registered yet

  if (PAIR_PHONE && !state.creds.registered) {

    const phone = PAIR_PHONE.replace(/\D/g, "");

    setTimeout(async () => {

      try {

        const code = await sock.requestPairingCode(phone);

        console.log("\n[whatsapp-bridge] Pairing code:");

        console.log(code, "\n");

      } catch (e) {

        console.error("[whatsapp-bridge] requestPairingCode failed:", e);

      }

    }, 1500);

  }

}



await startSock();



const app = express();

app.use(express.json({ limit: "1mb" }));



app.get("/health", (_, res) => res.json({ ok: true }));



app.post("/alertmanager", async (req, res) => {

  try {

    const headerToken = req.get("X-Alertmanager-Token");
    const auth = req.get("Authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
    const token = headerToken || bearer;

    if (token !== TOKEN) return res.status(401).json({ ok: false, error: "unauthorized" });

    const body = req.body || {};

    const alerts = Array.isArray(body.alerts) ? body.alerts : [];

    const status = body.status || "unknown";


    const title = status === "resolved"
  ? "✅ RESUELTO — Monitoreo iliagpt"
  : "🚨 ALERTA — Monitoreo iliagpt";
 
    const lines = alerts.slice(0, 10).map(fmtAlert);

    const text = [title, ...lines].join("\n\n");



    await sock.sendMessage(TO, { text });

    return res.json({ ok: true, sent: true, count: alerts.length });

  } catch (e) {

    console.error("send failed:", e);

    return res.status(500).json({ ok: false, error: String(e?.message || e) });

  }

});



app.listen(PORT, () => {

  console.log(`[whatsapp-bridge] listening on :${PORT}`);

  console.log(`[whatsapp-bridge] to=${TO}`);

});

