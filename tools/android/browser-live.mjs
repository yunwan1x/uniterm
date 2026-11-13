import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const b = await chromium.connectOverCDP(
  process.env.ANDROID_CDP || "http://127.0.0.1:19229",
);
const p = b.contexts()[0].pages()[0];
const tab = p.locator(".android-tab"),
  canvas = tab.locator("canvas");
await tab.getByRole("button", { name: "Home", exact: true }).click();
await p.waitForTimeout(400);
const box = await canvas.boundingBox();
await p.mouse.click(box.x + box.width * 0.39, box.y + box.height * 0.65);
await p.waitForTimeout(800);
const focus = execFileSync(process.env.UNITERM_ADB_BIN || "adb", [
  "-P",
  "15037",
  "-s",
  "127.0.0.1:15555",
  "shell",
  "dumpsys",
  "activity",
  "activities",
]).toString();
assert.match(focus, /mResumedActivity:.*gallery/i);
console.log("PASS real pointer touch launches Gallery");
await tab.getByRole("button", { name: "Home", exact: true }).click();
await tab.getByRole("button", { name: "Shell", exact: true }).click();
await tab.locator(".android-panel input").fill("printf uniterm-shell-ok");
await tab.getByRole("button", { name: "Send", exact: true }).click();
await p.waitForTimeout(700);
assert.match(await tab.locator("pre").innerText(), /uniterm-shell-ok/);
console.log("PASS ADB Shell");
await tab.locator(".android-panel .close").click();
await tab.getByRole("button", { name: "Files", exact: true }).click();
const data = Buffer.alloc(1048597);
for (let i = 0; i < data.length; i++) data[i] = (i * 29) % 256;
await tab
  .locator("input[type=file]")
  .setInputFiles({
    name: "round trip-你好.bin",
    mimeType: "application/octet-stream",
    buffer: data,
  });
await p.waitForTimeout(800);
assert.match(await tab.locator("[role=status]").innerText(), /Completed/);
await tab
  .locator(".android-panel input:not([type=file])")
  .fill("/sdcard/Download/round trip-你好.bin");
const cdp = await b.newBrowserCDPSession();
const ids = await cdp.send("Target.getBrowserContexts");
await cdp.send("Browser.setDownloadBehavior", {
  browserContextId: ids.browserContextIds[0],
  behavior: "allow",
  downloadPath: "/tmp/uniterm-android-downloads",
});
const download = p.waitForEvent("download");
await tab.getByRole("button", { name: "Download file", exact: true }).click();
const d = await download;
await p.waitForTimeout(800);
const got = fs.readFileSync(
  "/tmp/uniterm-android-downloads/" + d.suggestedFilename(),
);
assert.deepEqual(got, data);
console.log(
  "PASS browser upload/download",
  got.length,
  "SHA256",
  crypto.createHash("sha256").update(got).digest("hex"),
);
await p.screenshot({ path: "/tmp/uniterm-android-files.png" });
await tab.locator(".android-panel .close").click();
await tab.getByRole("button", { name: "Rotate", exact: true }).click();
await p.waitForTimeout(800);
console.log("after rotate", await tab.locator("footer span").innerText());
await p.screenshot({ path: "/tmp/uniterm-android-rotated.png" });
await b.close();
