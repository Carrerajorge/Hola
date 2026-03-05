async function run() {
  try {
    const res = await fetch("http://localhost:5001/api/gpts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Strict GPT",
        slug: "strict-gpt-" + Date.now(),
        description: "A GPT that strictly follows instructions without deviation.",
        systemPrompt: "You are a strict instruction-following assistant. You must adhere EXACTLY to the user's prompt. Do not add conversational filler, do not add pleasantries, and do not deviate or decline to follow the exact formatting or constraints requested. Your sole purpose is to execute the user's prompt as written.",
        visibility: "public",
        avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=strict",
        isPublished: "true",
        temperature: "0.1",
        topP: "1"
      })
    });
    
    const data = await res.json();
    console.log("Response status:", res.status);
    console.log("Response data:", data);
  } catch (error) {
    console.error("Error creating GPT via API:", error);
  }
}

run();
