import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import * as oidcTokenHash from 'oidc-token-hash';
import * as pem2jwk from 'pem-jwk';
import * as queryString from 'querystring';

import { IAuthReq } from '../../entities/auth.req.entity';
import { IClient } from '../../entities/client.entity';
import { IAccessToken, IIdToken } from '../../entities/token.entity';
import { IUser } from '../../entities/user.entity';
import { ClientRepository, IClientRepository } from '../../repository/client.repostory';
import { IUserRepository, UserRepository } from '../../repository/user.repository';

export class AuthReqProcessor {

    private clientRepository = new ClientRepository();
    private userRepository = new UserRepository();
    private puk;
    private pk;

    constructor() {
        this.puk = fs.readFileSync('./cert/pubkey.pem', 'ascii');
        this.pk = fs.readFileSync('./cert/key.pem');
    }

    private clientChecking(authReq: IAuthReq): Promise<IClient> {
        return new Promise((resolve, reject) => {
            if (authReq.scope.indexOf('openid') === -1) {
                 reject({ error: 'openid is required' });
            }
            this.clientRepository.getClientByClienId(authReq.client_id)
                .then((client) => {
                    if (client) {
                        if (client.redirectUris.indexOf(authReq.redirect_uri) > -1) {
                            resolve(client);
                        } else {
                            reject({ error: 'no redirect_uri' });
                        }
                    } else {
                        reject({ error: 'no client' });
                    }
                }).catch((err) => {
                    reject(err);
                });
        });

    }

    public async createResponse(userId: string, authReq: IAuthReq): Promise<string> {
        const client = await this.clientChecking(authReq);
        const user = await this.userRepository.getUserById(userId);
        const tokens = await this.createToke(user, client, authReq);
        const response = {
            access_token: tokens.accessTokenEncode,
            id_token: tokens.idTokenEncode,
            scope: client.allowedScopes,
            session_state: authReq.state,
            state: authReq.state,
            expires_in: client.accessTokenLifetime,
            token_type: "Bearer",
        };
        const stringified = queryString.stringify(response);
        const responseString = authReq.redirect_uri + '#' + stringified;
        return responseString;
    }

    private createToke(user: IUser, client: IClient, authReq: IAuthReq): Promise<{ accessTokenEncode: string, idTokenEncode: string }> {
        return new Promise((resolve) => {
            const accessToken: IAccessToken = {
                iss: "http://localhost:4000",
                aud: "http://localhost:4000",
                auth_time: Math.floor(Date.now() / 1000),
                client_id: client.clientId,
                exp: Math.floor(Date.now() / 1000) + client.accessTokenLifetime,
                nbf: Math.floor(Date.now() / 1000),
                sub: user.subjectId,
                scope: client.allowedScopes,
            };
            const accessTokenEncode = jwt.sign(accessToken, this.pk, { algorithm: 'RS256' });

            const idToken: IIdToken = {
                at_hash: oidcTokenHash.generate(accessTokenEncode),
                nbf: Math.floor(Date.now() / 1000),
                iss: "http://localhost:4000",
                aud: client.clientId,
                nonce: authReq.nonce,
                auth_time: Date.now(),
                exp: Math.floor(Date.now() / 1000) + client.identityTokenLifetime,
                iat: Math.floor(Date.now() / 1000),
                sid: authReq.state,
                sub: user.subjectId,
            };
            const idTokenEncode = jwt.sign(idToken, this.pk, { algorithm: 'RS256' });
            resolve({ accessTokenEncode, idTokenEncode });
        });
    }

}