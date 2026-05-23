import { PACKAGE_NAME, VERSION } from "@pie-lab/coding-agent/config";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface SiteApiOptions {
	packageName?: string;
	version?: string;
	installPackageName?: string;
}

export type PieLabSiteRequestHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createSiteRequestHandler(options: SiteApiOptions = {}): PieLabSiteRequestHandler {
	const packageName = options.packageName ?? PACKAGE_NAME;
	const version = options.version ?? VERSION;
	const installPackageName = options.installPackageName ?? packageName;

	return async (request, response) => {
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

		if (request.method === "OPTIONS") {
			response.writeHead(204, CORS_HEADERS);
			response.end();
			return;
		}

		if (url.pathname === "/api/latest-version") {
			if (request.method !== "GET") {
				writeJson(response, 405, { error: { message: "Only GET and OPTIONS requests are supported." } });
				return;
			}
			writeJson(response, 200, {
				packageName,
				version,
			});
			return;
		}

		if (url.pathname === "/api/report-install") {
			if (request.method !== "GET" && request.method !== "POST") {
				writeJson(response, 405, { error: { message: "Only GET, POST, and OPTIONS requests are supported." } });
				return;
			}
			writeJson(response, 200, {
				ok: true,
				packageName,
				reportedVersion: url.searchParams.get("version") ?? undefined,
			});
			return;
		}

		if (url.pathname === "/install.sh") {
			if (request.method !== "GET") {
				writeText(response, 405, "Only GET and OPTIONS requests are supported.\n", "text/plain; charset=utf-8");
				return;
			}
			writeText(response, 200, createInstallScript(installPackageName), "text/x-shellscript; charset=utf-8");
			return;
		}

		if (url.pathname === "/session" || url.pathname === "/session/") {
			if (request.method !== "GET") {
				writeText(response, 405, "Only GET and OPTIONS requests are supported.\n", "text/plain; charset=utf-8");
				return;
			}
			writeText(response, 200, createSessionViewerHtml(), "text/html; charset=utf-8");
			return;
		}

		writeJson(response, 404, {
			error: {
				message: "Not found",
				path: url.pathname,
			},
		});
	};
}

export function isSitePath(pathname: string): boolean {
	return (
		pathname === "/api/latest-version" ||
		pathname === "/api/report-install" ||
		pathname === "/install.sh" ||
		pathname === "/session" ||
		pathname === "/session/"
	);
}

function createInstallScript(packageName: string): string {
	return `#!/usr/bin/env sh
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install pie." >&2
  exit 1
fi

npm install -g ${shellQuote(packageName)}
echo "pie installed. Run: pie --help"
`;
}

function createSessionViewerHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>pie session</title>
</head>
<body>
  <main>
    <h1>pie session viewer</h1>
    <p>The session viewer shell is ready. A static viewer can be mounted here later.</p>
  </main>
</body>
</html>
`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
}

function writeText(response: ServerResponse, status: number, body: string, contentType: string): void {
	response.writeHead(status, {
		...CORS_HEADERS,
		"content-type": contentType,
	});
	response.end(body);
}
