import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_CANDIDATES = [
  path.join(__dirname, "..", "..", "client", "dist", "icons", "icon-192.png"),
  path.join(__dirname, "..", "..", "client", "public", "icons", "icon-192.png")
];

function uuid() {
  return crypto.randomUUID().toUpperCase();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readIconBase64() {
  for (const iconPath of ICON_CANDIDATES) {
    if (fs.existsSync(iconPath)) {
      return fs.readFileSync(iconPath).toString("base64");
    }
  }
  return "";
}

/**
 * Профіль Apple (.mobileconfig) — Web Clip «ENVER Оператор» на головний екран iPad/iPhone.
 * @param {string} operatorUrl — повна URL сторінки operator.html
 */
export function buildIpadInstallProfile(operatorUrl) {
  const webClipUuid = uuid();
  const rootUuid = uuid();
  const iconB64 = readIconBase64();
  const iconBlock = iconB64
    ? `
			<key>Icon</key>
			<data>${iconB64}</data>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>FullScreen</key>
			<true/>
			<key>IsRemovable</key>
			<true/>
			<key>Label</key>
			<string>ENVER Оператор</string>
			<key>PayloadDescription</key>
			<string>Панель оператора станків ENVER (повноекранний Web Clip).</string>
			<key>PayloadDisplayName</key>
			<string>ENVER Оператор</string>
			<key>PayloadIdentifier</key>
			<string>ua.enver.operator.webclip</string>
			<key>PayloadType</key>
			<string>com.apple.webClip.managed</string>
			<key>PayloadUUID</key>
			<string>${webClipUuid}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>Precomposed</key>
			<true/>${iconBlock}
			<key>URL</key>
			<string>${escapeXml(operatorUrl)}</string>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>Встановлює іконку клієнта оператора ENVER на головний екран iPad/iPhone.</string>
	<key>PayloadDisplayName</key>
	<string>ENVER Оператор</string>
	<key>PayloadIdentifier</key>
	<string>ua.enver.operator.profile</string>
	<key>PayloadOrganization</key>
	<string>ENVER</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${rootUuid}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`;
}
