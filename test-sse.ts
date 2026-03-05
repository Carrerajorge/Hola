import "dotenv/config";

async function run() {
    const initRes = await fetch("http://127.0.0.1:5001/api/auth/csrf-token");
    const initData = await initRes.json();
    const csrfToken = initData.csrfToken;

    const cookie = initRes.headers.get("set-cookie") || "";
    console.log("Got CSRF token:", csrfToken, "Cookie:", cookie.substring(0, 40));

    const requestId = "req_test_" + Date.now();
    const reqBody = {
        conversationId: "test_conv",
        requestId,
        messages: [
            { role: "user", content: "revisa mi carpeta hola en el escritorio de mi mac y me avisas que hay" }
        ],
        agenticMode: true,
        attachments: []
    };

    console.log("Sending request...");

    const res = await fetch("http://127.0.0.1:5001/api/chat/stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
            "cookie": cookie
        },
        body: JSON.stringify(reqBody)
    });

    console.log("Status:", res.status);

    if (!res.body) {
        console.log("No body");
        return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        console.log("----- CHUNK -----");
        console.log(chunk);
    }
}

run().catch(console.error);
