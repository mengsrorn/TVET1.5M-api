import {Schema, model, Types} from "mongoose";
import { IUsers } from "./users";

export interface IUser_tokens{
    _id: any;
    token: string,
    users: IUsers["_id"],
    status: number,
    device_os: string,
    device_name: string,
    create_at: Date,
    expire_at: number;
    public_ip: String;
    user_agent: string;
}
const schema = new Schema({
    token: String,
    users: { type: Types.ObjectId, ref: 'users' },
    status: Number,
    device_os: String,
    device_name: String,
    create_at: Date,
    expire_at: Number,
    user_agent: String,
    public_ip: String,
}, { timestamps: true});
 

export const modelUserToken = model<IUser_tokens>("user_tokens", schema);