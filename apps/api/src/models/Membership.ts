import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const membershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    role: {
      type: String,
      enum: ["owner", "admin", "member", "viewer"],
      required: true,
    },
  },
  { timestamps: true },
);

membershipSchema.index({ userId: 1, teamId: 1 }, { unique: true });

export type MembershipDoc = InferSchemaType<typeof membershipSchema> & {
  _id: Types.ObjectId;
};
export const Membership: Model<MembershipDoc> = model<MembershipDoc>(
  "Membership",
  membershipSchema,
);
