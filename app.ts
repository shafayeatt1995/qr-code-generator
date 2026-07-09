import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ServerResponse } from "http";
import type { ParsedQs } from "qs";
import qr from "qrcode";
import sharp from "sharp";
import cors from "cors";
import opentype from "opentype.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const isDev = process.env.NODE_ENV === "development";

function getProjectRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  if (process.env.VERCEL || path.basename(moduleDir) === "dist") {
    return process.cwd();
  }

  return moduleDir;
}

const rootDir = getProjectRoot();
const indexPath = path.join(rootDir, "public", "index.html");
const urbanistBoldPath = path.join(rootDir, "public", "fonts", "Urbanist-Bold.ttf");
const defaultPreviewSize = 1000;
const minQrSize = 10;
const maxQrSize = 4096;
const centerLabel = "Xorin Lab";
let livereloadClients: ServerResponse[] = [];
let cachedUrbanistFont: opentype.Font | null = null;

function getUrbanistFont(): opentype.Font {
  if (cachedUrbanistFont) return cachedUrbanistFont;

  if (!fs.existsSync(urbanistBoldPath)) {
    throw new Error(`Urbanist font not found at ${urbanistBoldPath}`);
  }

  cachedUrbanistFont = opentype.parse(fs.readFileSync(urbanistBoldPath).buffer);
  return cachedUrbanistFont;
}

app.get("/", (_req, res) => {
  if (isDev) {
    const html = fs.readFileSync(indexPath, "utf8");
    const reloadScript =
      '<script>new EventSource("/__livereload").onmessage=()=>location.reload();</script>';
    return res.send(html.replace("</body>", `${reloadScript}</body>`));
  }

  res.sendFile(indexPath);
});

if (isDev) {
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

async function textPlate(
  label: string,
  darkColor: string,
  lightColor: string,
  plateSize: number,
  fontSize: number,
): Promise<Buffer> {
  const dark = normalizeHexColor(darkColor);
  const light = normalizeHexColor(lightColor);
  const font = getUrbanistFont();
  const words = label.split(" ");
  const lineHeight = fontSize * 1.15;
  const cornerRadius = Math.round(plateSize * 0.24);

  const firstWordBBox = font.getPath(words[0], 0, 0, fontSize).getBoundingBox();
  const lastWordBBox = font
    .getPath(words[words.length - 1], 0, 0, fontSize)
    .getBoundingBox();
  const blockHeight =
    (words.length - 1) * lineHeight + (lastWordBBox.y2 - firstWordBBox.y1);
  const minTop = Math.max(4, Math.round(plateSize * 0.06));
  let firstBaseline = (plateSize - blockHeight) / 2 - firstWordBBox.y1;

  if (firstBaseline + firstWordBBox.y1 < minTop) {
    firstBaseline = minTop - firstWordBBox.y1;
  }

  const wordPaths = words.map((word, index) => {
    const y = firstBaseline + index * lineHeight;
    const path = font.getPath(word, 0, y, fontSize);
    const bbox = path.getBoundingBox();
    const x = (plateSize - (bbox.x2 - bbox.x1)) / 2 - bbox.x1;
    return font.getPath(word, x, y, fontSize).toPathData(2);
  });

  const bgSvg = `<svg width="${plateSize}" height="${plateSize}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${plateSize}" height="${plateSize}" fill="${light}" rx="${cornerRadius}" ry="${cornerRadius}"/>
  </svg>`;
  const bg = await sharp(Buffer.from(bgSvg)).png().toBuffer();

  const textLayers = await Promise.all(
    wordPaths.map(async (pathData) => {
      const textSvg = `<?xml version="1.0" encoding="UTF-8"?><svg width="${plateSize}" height="${plateSize}" overflow="visible" xmlns="http://www.w3.org/2000/svg"><path d="${pathData}" fill="${dark}"/></svg>`;
      return { input: await sharp(Buffer.from(textSvg)).png().toBuffer() };
    }),
  );

  return sharp(bg).composite(textLayers).png().toBuffer();
}

function parseQrSize(value: string | undefined, fallback: number): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.min(maxQrSize, Math.max(minQrSize, Math.round(size)));
}

async function generateQrWithLabel(
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

  const labelSize = Math.round(size * 0.12);
  const padding = 6;
  const plateSize = labelSize + padding * 2;
  const fontPlateSize = Math.round(size * 0.16) + 16;
  const fontSize = Math.round(
    fontPlateSize * (centerLabel.split(" ").length > 1 ? 0.22 : 0.26),
  );

  const labelPlate = await textPlate(
    centerLabel,
    darkColor,
    lightColor,
    plateSize,
    fontSize,
  );

  return sharp(qrBuffer)
    .composite([{ input: labelPlate, gravity: "center" }])
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
    const qrImage = await generateQrWithLabel(
      text,
      darkColor,
      lightColor,
      size,
    );

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Disposition": download
        ? 'attachment; filename="Xorin Lab QR Code.png"'
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
