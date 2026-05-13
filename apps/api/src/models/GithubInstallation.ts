import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const githubInstallationSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    installationId: { type: Number, required: true },
    accountLogin: { type: String, required: true },
    accountId: { type: Number, required: true },
    accountType: { type: String, enum: ["User", "Organization"], required: true },
    avatarUrl: { type: String, default: "" },
  },
  { timestamps: true },
);

githubInstallationSchema.index({ teamId: 1, installationId: 1 }, { unique: true });

export type GithubInstallationDoc = InferSchemaType<typeof githubInstallationSchema> & {
  _id: Types.ObjectId;
};
export const GithubInstallation: Model<GithubInstallationDoc> =
  model<GithubInstallationDoc>("GithubInstallation", githubInstallationSchema);
