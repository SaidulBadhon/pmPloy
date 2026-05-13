import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export type TeamDoc = InferSchemaType<typeof teamSchema> & {
  _id: Types.ObjectId;
};
export const Team: Model<TeamDoc> = model<TeamDoc>("Team", teamSchema);
