import { nativeDesktop } from "../server/native/index.js";

async function runE2E() {
    console.log("=== Phase 4.3: E2E Native Daemon Integration Test ===");
    console.log("1. Verifying Daemon Connection & Window Listing...");
    try {
        const windows = await nativeDesktop.listWindows();
        console.log(`✅ Success: Retrieved ${windows.length} windows from OS native API.`);

        console.log("\n2. Emulating Agent Action: Open Safari via executeSystemScript...");
        const scriptResult = await nativeDesktop.executeSystemScript('tell application "Safari" to activate');
        console.log(`✅ Success: AppleScript executed. Result: ${scriptResult}`);

        console.log("\n3. Verifying OS State update (Capturing UI focused element)...");
        const focused = await nativeDesktop.getFocusedElement();
        console.log(`✅ Success: Focused element is ${focused?.title || focused?.role} (ID: ${focused?.id})`);

        console.log("\n🎉 Phase 4 E2E Test Completed Successfully!");
        process.exit(0);
    } catch (e: any) {
        console.error("❌ E2E Test Failed:", e.message);
        process.exit(1);
    }
}

runE2E();
