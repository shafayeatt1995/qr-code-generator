import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ServerResponse } from "http";
import type { ParsedQs } from "qs";
import qr from "qrcode";
import sharp from "sharp";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT) || 3000;
const isDev = process.env.NODE_ENV === "development";
const rootDir = process.env.VERCEL
  ? process.cwd()
  : path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(rootDir, "public", "index.html");
const logoPath = path.join(rootDir, "public", "logo.avif");
const defaultPreviewSize = 800;
const minQrSize = 100;
const maxQrSize = 4096;
let livereloadClients: ServerResponse[] = [];

if (isDev) {
  app.get("/", (_req, res) => {
    const html = fs.readFileSync(indexPath, "utf8");
    const reloadScript =
      '<script>new EventSource("/__livereload").onmessage=()=>location.reload();</script>';
    return res.send(html.replace("</body>", `${reloadScript}</body>`));
  });

  app.get("/__livereload", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    livereloadClients.push(res);
    req.on("close", () => {
      livereloadClients = livereloadClients.filter((client) => client !== res);
    });
  });

  fs.watch(indexPath, () => {
    livereloadClients.forEach((client) => client.write("data: reload\n\n"));
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(rootDir, "public")));

function getQueryParam(
  value: string | ParsedQs | (string | ParsedQs)[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const val = Array.isArray(value) ? value[0] : value;
  return typeof val === "string" ? val : undefined;
}

function normalizeHexColor(color: string): string {
  return color.startsWith("#") ? color : `#${color}`;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

async function logoForPlate(
  plateColor: { r: number; g: number; b: number },
  logoSize: number,
): Promise<Buffer> {
  const { data, info } = await sharp(logoPath)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { ...plateColor, alpha: 1 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const threshold = 235;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r >= threshold && g >= threshold && b >= threshold) {
      data[i] = plateColor.r;
      data[i + 1] = plateColor.g;
      data[i + 2] = plateColor.b;
      data[i + 3] = 255;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();
}

function parseQrSize(value: string | undefined, fallback: number): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.min(maxQrSize, Math.max(minQrSize, Math.round(size)));
}

async function generateQrWithLogo(
  text: string,
  darkColor: string,
  lightColor: string,
  size: number,
): Promise<Buffer> {
  const qrBuffer = await qr.toBuffer(text, {
    margin: 1,
    width: size,
    errorCorrectionLevel: "H",
    color: {
      dark: normalizeHexColor(darkColor),
      light: normalizeHexColor(lightColor),
    },
  });

  const logoSize = Math.round(size * 0.2);
  const padding = 12;
  const plateColor = hexToRgb(normalizeHexColor(lightColor));

  const logo = await logoForPlate(plateColor, logoSize);

  const logoPlate = await sharp({
    create: {
      width: logoSize + padding * 2,
      height: logoSize + padding * 2,
      channels: 4,
      background: { ...plateColor, alpha: 1 },
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();

  return sharp(qrBuffer)
    .composite([{ input: logoPlate, gravity: "center" }])
    .png()
    .toBuffer();
}

const router = express.Router();

router.get("/test", (_req, res) => {
  res.json({ message: "CORS is working!" });
});

router.get("/qr", async (req, res) => {
  try {
    const text = getQueryParam(req.query.text);
    const color = getQueryParam(req.query.color);
    const bg = getQueryParam(req.query.bg);
    const size = parseQrSize(
      getQueryParam(req.query.size),
      defaultPreviewSize,
    );
    const download = getQueryParam(req.query.download) === "1";

    if (!text) {
      return res.status(400).send("Missing required parameters");
    }

    const defaultColor = "#000000";
    const defaultBgColor = "#FFFFFF";
    const darkColor = color || defaultColor;
    const lightColor = bg || defaultBgColor;
    const qrImage = await generateQrWithLogo(
      text,
      darkColor,
      lightColor,
      size,
    );

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Disposition": download
        ? `attachment; filename=qr-code-${size}px.png`
        : "inline; filename=qr-code.png",
    });

    res.end(qrImage);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating QR code");
  }
});

app.use(router);
app.use("/api", router);

export default app;

if (!process.env.VERCEL && import.meta.main) {
  const server = app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process or run with PORT=3001 bun run dev`,
      );
      process.exit(1);
    }

    throw error;
  });
}
