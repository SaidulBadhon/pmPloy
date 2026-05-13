import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const applicationSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },

    // Source description. For milestone 3 only "local" is wired up;
    // "github" lands in a later milestone.
    sourceType: {
      type: String,
      enum: ["local", "github"],
      default: "local",
      required: true,
    },
    // For sourceType === "local": absolute path to the working directory.
    cwd: { type: String, required: true },
    // Command to launch; mapped to PM2's `script` (with shell-style args).
    script: { type: String, required: true },
    // Optional interpreter (e.g. "bun", "node", "python"). Empty = let pm2 infer.
    interpreter: { type: String, default: "" },
    // PM2 cluster vs fork. "max" / number for cluster, omit for fork.
    instances: { type: Number, default: 1 },
    execMode: {
      type: String,
      enum: ["fork", "cluster"],
      default: "fork",
      required: true,
    },

    // Port allocated to this app (used later for reverse-proxy mapping).
    port: { type: Number, required: false },

    status: {
      type: String,
      enum: ["created", "deploying", "running", "stopped", "errored"],
      default: "created",
      required: true,
    },
    // PM2 process name = `pmploy:<appId>` — denormalized for convenience.
    pm2Name: { type: String, required: true },
  },
  { timestamps: true },
);

applicationSchema.index({ teamId: 1, slug: 1 }, { unique: true });

export type ApplicationDoc = InferSchemaType<typeof applicationSchema> & {
  _id: Types.ObjectId;
};
export const Application: Model<ApplicationDoc> = model<ApplicationDoc>(
  "Application",
  applicationSchema,
);
