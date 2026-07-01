import { BaseRetriever } from '@langchain/core/retrievers'
import { ContextualCompressionRetriever } from '@langchain/classic/retrievers/contextual_compression'
import { getCredentialData, getCredentialParam, handleEscapeCharacters } from '../../../src'
import { ICommonObject, INode, INodeData, INodeOutputsValue, INodeParams } from '../../../src/Interface'
import { CloudruRerank } from './CloudruRerank'

class CloudruRerankRetriever_Retrievers implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]
    credential: INodeParams
    badge: string
    outputs: INodeOutputsValue[]

    constructor() {
        this.label = 'Cloud.ru Rerank Retriever'
        this.name = 'cloudruRerankRetriever'
        this.version = 1.0
        this.type = 'CloudruRerankRetriever'
        this.icon = 'cloudru.svg'
        this.category = 'Retrievers'
        this.description =
            'Rerank documents with Cloud.ru Foundation Models (Qwen3-Reranker) or any OpenAI-compatible "/score" endpoint, from most to least relevant to the query.'
        this.baseClasses = [this.type, 'BaseRetriever']
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['cloudruApi']
        }
        this.inputs = [
            {
                label: 'Vector Store Retriever',
                name: 'baseRetriever',
                type: 'VectorStoreRetriever'
            },
            {
                label: 'Model Name',
                name: 'model',
                type: 'string',
                default: 'Qwen/Qwen3-Reranker-0.6B',
                description: 'Reranker model served by the endpoint'
            },
            {
                label: 'Query',
                name: 'query',
                type: 'string',
                description: 'Query to retrieve documents from retriever. If not specified, user question will be used',
                optional: true,
                acceptVariable: true
            },
            {
                label: 'Base URL',
                name: 'baseURL',
                type: 'string',
                description: 'Base URL of the OpenAI-compatible endpoint. The "/score" path is appended automatically.',
                default: 'https://foundation-models.api.cloud.ru',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Top N',
                name: 'topN',
                description: 'Number of top results to fetch. Default to 4',
                placeholder: '4',
                default: 4,
                type: 'number',
                additionalParams: true,
                optional: true
            }
        ]
        this.outputs = [
            {
                label: 'Cloud.ru Rerank Retriever',
                name: 'retriever',
                baseClasses: this.baseClasses
            },
            {
                label: 'Document',
                name: 'document',
                description: 'Array of document objects containing metadata and pageContent',
                baseClasses: ['Document', 'json']
            },
            {
                label: 'Text',
                name: 'text',
                description: 'Concatenated string from pageContent of documents',
                baseClasses: ['string', 'json']
            }
        ]
    }

    async init(nodeData: INodeData, input: string, options: ICommonObject): Promise<any> {
        const baseRetriever = nodeData.inputs?.baseRetriever as BaseRetriever
        const model = (nodeData.inputs?.model as string) || 'Qwen/Qwen3-Reranker-0.6B'
        const query = nodeData.inputs?.query as string
        const baseURL = (nodeData.inputs?.baseURL as string) || 'https://foundation-models.api.cloud.ru'
        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const cloudruApiKey = getCredentialParam('cloudruApiKey', credentialData, nodeData)
        const topN = nodeData.inputs?.topN ? parseFloat(nodeData.inputs?.topN as string) : 4
        const output = nodeData.outputs?.output as string

        const cloudruCompressor = new CloudruRerank(cloudruApiKey, model, baseURL, topN)

        const retriever = new ContextualCompressionRetriever({
            baseCompressor: cloudruCompressor,
            baseRetriever: baseRetriever
        })

        if (output === 'retriever') return retriever
        else if (output === 'document') return await retriever.invoke(query ? query : input)
        else if (output === 'text') {
            const docs = await retriever.invoke(query ? query : input)
            let finaltext = ''
            for (const doc of docs) finaltext += `${doc.pageContent}\n`

            return handleEscapeCharacters(finaltext, false)
        }

        return retriever
    }
}

module.exports = { nodeClass: CloudruRerankRetriever_Retrievers }
