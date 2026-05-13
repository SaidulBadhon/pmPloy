import mongoose from "mongoose";
import { env } from "./env.ts";

let connected = false;

export async function connectDb(): Promise<typeof mongoose> {
  if (connected) return mongoose;
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  connected = true;
  console.log(`[db] connected to ${env.MONGO_URI}`);
  return mongoose;
}

export function dbStatus(): "connected" | "connecting" | "disconnected" | "disconnecting" {
  const map = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  } as const;
  return map[mongoose.connection.readyState as 0 | 1 | 2 | 3] ?? "disconnected";
}
