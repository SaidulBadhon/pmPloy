import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const envVarSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    appId: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    serviceName: { type: String, default: "" },
    key: { type: String, required: true, trim: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { timestamps: true },
);

envVarSchema.index({ appId: 1, serviceName: 1, key: 1 }, { unique: true });

export type EnvVarDoc = InferSchemaType<typeof envVarSchema> & {
  _id: Types.ObjectId;
};
export const EnvVar: Model<EnvVarDoc> = model<EnvVarDoc>("EnvVar", envVarSchema);
