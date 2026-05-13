import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const sealedSchema = new Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);

const githubAppConfigSchema = new Schema(
  {
    // Singleton enforcement: this field is always "default".
    singleton: { type: String, required: true, unique: true, default: "default" },
    appId: { type: String, required: true },
    slug: { type: String, required: true },
    clientId: { type: String, required: true },
    htmlUrl: { type: String, default: "" },
    name: { type: String, default: "" },
    sealedPrivateKeyPem: { type: sealedSchema, required: true },
    sealedWebhookSecret: { type: sealedSchema, required: true },
    sealedClientSecret: { type: sealedSchema, required: true },
  },
  { timestamps: true },
);

export type GithubAppConfigDoc = InferSchemaType<typeof githubAppConfigSchema> & {
  _id: Types.ObjectId;
};
export const GithubAppConfig: Model<GithubAppConfigDoc> =
  model<GithubAppConfigDoc>("GithubAppConfig", githubAppConfigSchema);
