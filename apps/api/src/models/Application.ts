import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const githubSourceSchema = new Schema(
  {
    installationId: { type: Number, required: true },
    repo: { type: String, required: true }, // "owner/name"
    branch: { type: String, required: true, default: "main" },
    rootDir: { type: String, default: "" }, // optional sub-directory
    buildCommand: { type: String, default: "" },
  },
  { _id: false },
);

const serviceSchema = new Schema(
  {
    name: { type: String, required: true },        // from ecosystem.config.cjs
    pm2Name: { type: String, required: true },     // "pmploy:<appId>:<name>"
    port: { type: Number, default: null },         // null = no public port
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const applicationSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },

    sourceType: {
      type: String,
      enum: ["local", "github"],
      default: "local",
      required: true,
    },
    cwd: { type: String, default: "" },
    script: { type: String, required: true },
    interpreter: { type: String, default: "" },
    instances: { type: Number, default: 1 },
    execMode: {
      type: String,
      enum: ["fork", "cluster"],
      default: "fork",
      required: true,
    },

    github: { type: githubSourceSchema, required: false },

    port: { type: Number, required: false },

    status: {
      type: String,
      enum: ["created", "deploying", "running", "stopped", "errored", "degraded"],
      default: "created",
      required: true,
    },
    pm2Name: { type: String, required: true },
    services: { type: [serviceSchema], default: [] },
  },
  { timestamps: true },
);

applicationSchema.index({ teamId: 1, slug: 1 }, { unique: true });

export type ServiceDoc = InferSchemaType<typeof serviceSchema>;
export type ApplicationDoc = InferSchemaType<typeof applicationSchema> & {
  _id: Types.ObjectId;
};
export const Application: Model<ApplicationDoc> = model<ApplicationDoc>(
  "Application",
  applicationSchema,
);
