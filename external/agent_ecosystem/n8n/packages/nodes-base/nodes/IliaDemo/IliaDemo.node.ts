import {
    IExecuteFunctions,
    IDataObject,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionTypes,
} from 'n8n-workflow';

export class IliaDemo implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Ilia Demo',
        name: 'iliaDemo',
        // eslint-disable-next-line n8n-nodes-base/node-class-description-icon-not-svg
        icon: 'file:ilia.svg',
        group: ['output'],
        version: 1,
        subtitle: '={{$parameter["operation"]}}',
        description: 'Consume Ilia Demo API',
        defaults: {
            name: 'Ilia Demo',
        },
        usableAsTool: true,
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        credentials: [
            {
                name: 'iliaDemoApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Get Data',
                        value: 'getData',
                        description: 'Get some demo data',
                        action: 'Get some demo data',
                    },
                ],
                default: 'getData',
                description: 'Operation to consume',
            },
            {
                displayName: 'Message',
                name: 'message',
                type: 'string',
                default: '',
                required: true,
                description: 'The message to send',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const length = items.length;

        for (let i = 0; i < length; i++) {
            try {
                const message = this.getNodeParameter('message', i) as string;
                const responseData: IDataObject = { result: `Received: ${message}`, source: 'IliaDemo' };
                const executionData = this.helpers.constructExecutionMetaData(
                    this.helpers.returnJsonArray([responseData]),
                    { itemData: { item: i } },
                );
                returnData.push(...executionData);
            } catch (error) {
                if (this.continueOnFail()) {
                    const executionErrorData = this.helpers.constructExecutionMetaData(
                        this.helpers.returnJsonArray({ error: error.message }),
                        { itemData: { item: i } },
                    );
                    returnData.push(...executionErrorData);
                    continue;
                }
                throw error;
            }
        }
        return [returnData];
    }
}
