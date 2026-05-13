import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const deploymentSchema = new Schema(
  {
    appId: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },

    commitSha: { type: String, default: "" },
    commitMessage: { type: String, default: "" },
    branch: { type: String, default: "" },

    triggeredBy: {
      type: String,
      enum: ["webhook", "manual", "user"],
      required: true,
    },
    triggeredByUserId: { type: Schema.Types.ObjectId, ref: "User" },

    status: {
      type: String,
      enum: ["queued", "building", "live", "failed", "cancelled"],
      default: "queued",
      required: true,
    },
    errorMessage: { type: String, default: "" },

    // Build workdir (filled once a clone has succeeded).
    workdir: { type: String, default: "" },

    // Append-only log; capped via $slice in the worker.
    logs: { type: [String], default: [] },

    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);

export type DeploymentDoc = InferSchemaType<typeof deploymentSchema> & {
  _id: Types.ObjectId;
};
export const Deployment: Model<DeploymentDoc> = model<DeploymentDoc>(
  "Deployment",
  deploymentSchema,
);

// Max log lines we persist per deployment.
export const DEPLOYMENT_LOG_LIMIT = 2000;
