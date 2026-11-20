import { Db, MongoClient } from "mongodb";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectDatabase(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;

  if (!uri) {
    throw new Error("MONGODB_URI is missing from environment variables");
  }

  if (!dbName) {
    throw new Error("MONGODB_DB_NAME is missing from environment variables");
  }

  if (database) {
    return database;
  }

  client = new MongoClient(uri);
  await client.connect();

  database = client.db(dbName);

  await database.command({ ping: 1 });

  console.log(`MongoDB connected successfully: ${dbName}`);

  return database;
}

export function getDatabase(): Db {
  if (!database) {
    throw new Error("Database is not connected yet");
  }

  return database;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error("MongoDB client is not connected yet");
  }

  return client;
}
