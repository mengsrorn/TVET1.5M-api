import { IUser_tokens } from '../models';
import AbstractController from './abstract_controller';
import { Model } from 'mongoose';

const { refresh_token_duration_as_day } = process.env;

export default class UserTokenController extends AbstractController<IUser_tokens> {
    model: Model<IUser_tokens>;
    constructor(model: Model<IUser_tokens>) {
        super(model);
        this.model = model;
    }
    public async createToken(token: string, users: string, req: any) {
        let expAt = (Number(refresh_token_duration_as_day) * 24 * 60 * 60 * 1000) + new Date().getTime();
        let modelData = new this.model({ token: token, users: users, status: 1, create_at: new Date(), expire_at: expAt });
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        modelData.public_ip = ip;
        modelData.user_agent = req.headers['user-agent'];
        return this.model.create(modelData);
    }
    public async getToken(token: string): Promise<IUser_tokens> {
        let getToken = await this.model.findOne({ token: token, status: 1 });
        if (!getToken) {
            throw this.throwHttpError('unauthorized');
        }
        if (getToken.expire_at < new Date().getTime()) {
            this.model.findOneAndUpdate({ _id: getToken._id }, { status: -1 });
            getToken.status = 2;
        }
        return getToken;
    }
    public async updateToken(token: string) {
        return this.model.findOneAndUpdate({ token: token },{ last_update: new Date() });
    }
    public async deleteOneByToken(token: string) {
        return this.model.findOneAndUpdate({ token: token, status : 1 }, { status: -1 });
    }
    public async deleletOtherDeviceToken(token: string, device: string) {
        
    }

    public async disableAllTokens(user: string) {
        return this.model.updateMany({ users: user }, { $set: { status: -1 } });
    }
}