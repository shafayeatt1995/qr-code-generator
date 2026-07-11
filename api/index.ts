import { fileURLToPath } from "url";
import app from "../app.js";

export default app;

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const startPort = Number(process.env.PORT) || 3000;

  function listenOnAvailablePort(attempt = 0): void {
    const maxAttempts = 100;
    const port = startPort + attempt;
    const server = app.listen(port, () => {
      if (port !== startPort) {
        console.log(`Port ${startPort} is in use, using port ${port} instead`);
      }
      console.log(`Server is running at http://localhost:${port}`);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        server.close();
        if (attempt + 1 < maxAttempts) {
          listenOnAvailablePort(attempt + 1);
          return;
        }

        console.error(
          `No available port found between ${startPort} and ${port}`,
        );
        process.exit(1);
      }

      throw error;
    });
  }

  listenOnAvailablePort();
}
