const express = require("express");
const qr = require("qrcode");
const suggest = require("suggestion");
const cors = require("cors");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/test", (req, res) => {
  res.json({ message: "CORS is working!" });
});

app.get("/qr", async (req, res) => {
  try {
    const { text, color, bg } = req.query;

    if (!text) {
      return res.status(400).send("Missing required parameters");
    }

    // Default colors
    const defaultColor = "#000000";
    const defaultBgColor = "#FFFFFF";

    // Use query parameters if available, otherwise use defaults
    const darkColor = color || defaultColor;
    const lightColor = bg || defaultBgColor;

    const qrCode = await qr.toDataURL(text, {
      margin: 1,
      height: 800,
      width: 800,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });

    // Set response headers for image
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Disposition": "inline; filename=qr-code.png",
    });

    // Send the image data
    res.end(Buffer.from(qrCode.split(",")[1], "base64"));
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating QR code");
  }
});

app.get("/result", async (req, res) => {
  try {
    const { q, gl, hl, client, output = 0 } = req.query;
    const options = { q, gl, hl, levels: 1 };
    if (client === "youtube") options.client = "youtube";
    let suggestions = await new Promise((resolve, reject) => {
      suggest(q, options, (err, suggestions) => {
        if (err) reject(err);
        resolve(suggestions);
      });
    });

    suggestions = suggestions.slice(0, output);

    const meta = { keyword: q, country: gl, language: hl, client };

    return res.json({ suggestions, meta });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
