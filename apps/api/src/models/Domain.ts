import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const domainSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    appId: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    host: { type: String, required: true, lowercase: true, trim: true, unique: true },
    sslStatus: {
      type: String,
      enum: ["pending", "active", "error", "unknown"],
      default: "pending",
      required: true,
    },
    lastError: { type: String, default: "" },
    serviceName: { type: String, default: "" }, // "" = route to the primary service
  },
  { timestamps: true },
);

export type DomainDoc = InferSchemaType<typeof domainSchema> & {
  _id: Types.ObjectId;
};
export const Domain: Model<DomainDoc> = model<DomainDoc>("Domain", domainSchema);

/** Stable Caddy @id used for the route object we manage. */
export function caddyRouteId(host: string): string {
  return `pmploy:domain:${host}`;
}
