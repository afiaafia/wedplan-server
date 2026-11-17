import "dotenv/config";
import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import { createCollections } from "./config/collections.js";

const PORT = Number(process.env.PORT) || 5000;

async function startServer(): Promise<void> {
  try {
    await connectDatabase();
    await createCollections();

    app.listen(PORT, () => {
      console.log(`WedPlan API running on http://localhost:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Failed to start WedPlan server:", error);
    process.exit(1);
  }
}

startServer();
