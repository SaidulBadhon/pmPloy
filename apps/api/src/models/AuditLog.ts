import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const auditLogSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    userEmail: { type: String, default: "" },
    action: { type: String, required: true },
    targetType: { type: String, default: "" }, // e.g. "app", "domain", "member"
    targetId: { type: String, default: "" },
    targetLabel: { type: String, default: "" }, // human-readable name
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & {
  _id: Types.ObjectId;
};
export const AuditLog: Model<AuditLogDoc> = model<AuditLogDoc>(
  "AuditLog",
  auditLogSchema,
);
