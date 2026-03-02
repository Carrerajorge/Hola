import {
    IAuthenticateGeneric,
    ICredentialTestRequest,
    ICredentialType,
    INodeProperties,
} from 'n8n-workflow';

export class IliaDemoApi implements ICredentialType {
    name = 'iliaDemoApi';
    displayName = 'Ilia Demo API';
    // eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-missing
    documentationUrl = 'https://example.com';
    properties: INodeProperties[] = [
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            default: '',
        },
    ];
    authenticate: IAuthenticateGeneric = {
        type: 'generic',
        properties: {
            qs: {
                api_key: '={{$credentials.apiKey}}',
            },
        },
    };
    test: ICredentialTestRequest = {
        request: {
            baseURL: 'https://api.example.com',
            url: '/me',
        },
    };
}
