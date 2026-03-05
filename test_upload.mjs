import fs from 'fs';
import path from 'path';

async function runTest() {
    console.log("Starting upload test...");

    // 1. Get Upload URL
    console.log("1. Requesting /api/objects/upload");
    const uploadId = `test-upload-${Date.now()}`;
    const getUrlRes = await fetch("http://localhost:5000/api/objects/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            uploadId,
            fileName: "test.txt",
            mimeType: "text/plain",
            fileSize: 12
        })
    });

    if (!getUrlRes.ok) {
        console.error("Failed to get upload URL:", await getUrlRes.text());
        return;
    }
    const urlData = await getUrlRes.json();
    console.log("Got upload URL data:", urlData);

    // 2. Upload file content to local-upload
    const uploadUrl = urlData.uploadURL;
    if (!uploadUrl) return console.error("No upload URL returned.");

    console.log(`2. Uploading content to localhost:5000${uploadUrl}`);
    const putRes = await fetch(`http://localhost:5000${uploadUrl}`, {
        method: "PUT",
        body: Buffer.from("Hello World!")
    });

    if (!putRes.ok) {
        console.error("PUT upload failed:", putRes.status, await putRes.text());
        return;
    }

    console.log("PUT successful:", await putRes.json());

    // 3. Register file
    console.log("3. Registering file at /api/files");
    const registerRes = await fetch("http://localhost:5000/api/files", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Upload-Id": uploadId
        },
        body: JSON.stringify({
            name: "test.txt",
            type: "text/plain",
            size: 12,
            storagePath: urlData.storagePath,
            uploadId
        })
    });

    if (!registerRes.ok) {
        console.error("Register failed:", registerRes.status, await registerRes.text());
        return;
    }

    const fileData = await registerRes.json();
    console.log("Register successful. File ID:", fileData.id);

    // 4. Poll for status
    let attempts = 0;
    while (attempts < 10) {
        attempts++;
        console.log(`Polling status... attempt ${attempts}`);
        const statusRes = await fetch(`http://localhost:5000/api/files/${fileData.id}/content`);
        const statusData = await statusRes.json();
        console.log("Status:", statusData);
        if (statusData.status === "ready" || statusData.status === "error") {
            break;
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log("Test complete.");
}

runTest().catch(console.error);
